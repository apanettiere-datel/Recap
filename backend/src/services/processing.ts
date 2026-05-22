import OpenAI from "openai";
import { readFile } from "node:fs/promises";
import { db } from "./db.js";
import { notes, commitments, topics, people, notePeople, quotes } from "../models/schema.js";
import { eq, and } from "drizzle-orm";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface Entity {
  type: "PERSON" | "ORGANIZATION" | "PHONE" | "DATE" | "EMAIL" | "LOCATION";
  text: string;
  context?: string;
}

interface AnalysisResult {
  title: string;
  summary: string;
  sentiment: string;
  commitments: {
    description: string;
    owner: "me" | "them";
    due_date: string | null;
    person_name: string | null;
  }[];
  people: string[];
  topics: string[];
  quotes: {
    text: string;
    speaker: string;
  }[];
  entities: Entity[];
}

export async function processNote(noteId: string, userId: string) {
  try {
    const [note] = await db.select().from(notes).where(eq(notes.id, noteId));
    if (!note) return;

    const transcript = await transcribeAudio(note.audioUrl);

    await db
      .update(notes)
      .set({ transcript })
      .where(eq(notes.id, noteId));

    const knownPeople = await db
      .select()
      .from(people)
      .where(eq(people.userId, userId));

    const analysis = await analyzeTranscript(transcript, note.conversationMode, knownPeople);

    await db
      .update(notes)
      .set({
        title: analysis.title,
        summary: analysis.summary,
        sentiment: analysis.sentiment,
        isProcessing: false,
      })
      .where(eq(notes.id, noteId));

    // Store commitments — link to the specific person mentioned
    for (const c of analysis.commitments) {
      const personName = c.person_name || analysis.people[0] || null;
      const person = personName ? await findOrCreatePerson(userId, personName) : null;
      await db.insert(commitments).values({
        userId,
        noteId,
        personId: person?.id,
        description: c.description,
        owner: c.owner,
        dueDate: c.due_date ? new Date(c.due_date) : null,
      });
    }

    for (const label of analysis.topics) {
      await db.insert(topics).values({ noteId, label });
    }

    for (const q of analysis.quotes) {
      const person = await findOrCreatePerson(userId, q.speaker);
      await db.insert(quotes).values({
        noteId,
        personId: person?.id,
        text: q.text,
        speaker: q.speaker,
      });
    }

    // Link people to note
    for (const name of analysis.people) {
      const person = await findOrCreatePerson(userId, name);
      if (person) {
        await db.insert(notePeople).values({ noteId, personId: person.id }).onConflictDoNothing();
        await db
          .update(people)
          .set({ lastContactDate: note.recordedAt })
          .where(eq(people.id, person.id));
      }
    }

    // Enrich people with extracted entities (phone, email, org)
    await enrichPeopleFromEntities(userId, analysis.entities, analysis.people);

  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await db
      .update(notes)
      .set({ isProcessing: false, processingError: message })
      .where(eq(notes.id, noteId));
  }
}

async function enrichPeopleFromEntities(userId: string, entities: Entity[], personNames: string[]) {
  if (!entities || entities.length === 0) return;

  const phones = entities.filter(e => e.type === "PHONE");
  const emails = entities.filter(e => e.type === "EMAIL");
  const orgs = entities.filter(e => e.type === "ORGANIZATION");

  // If there's exactly one person and we found contact info, attach it
  if (personNames.length === 1) {
    const person = await findOrCreatePerson(userId, personNames[0]);
    if (person) {
      const updates: Record<string, string> = {};
      if (phones.length > 0 && !person.phone) updates.phone = phones[0].text;
      if (emails.length > 0 && !person.email) updates.email = emails[0].text;
      if (orgs.length > 0 && !person.organization) updates.organization = orgs[0].text;
      if (Object.keys(updates).length > 0) {
        await db.update(people).set(updates).where(eq(people.id, person.id));
      }
    }
  }

  // Create org entries as people too (for CRM tracking)
  for (const org of orgs) {
    const existing = await db
      .select()
      .from(people)
      .where(and(eq(people.userId, userId), eq(people.name, org.text.trim())))
      .limit(1);
    if (existing.length === 0) {
      await db.insert(people).values({
        userId,
        name: org.text.trim(),
        relationship: "organization",
        organization: org.text.trim(),
      });
    }
  }
}

async function transcribeAudio(audioUrl: string): Promise<string> {
  let audioBuffer: ArrayBuffer;

  if (audioUrl.startsWith("file://")) {
    const filePath = audioUrl.slice(7);
    audioBuffer = (await readFile(filePath)).buffer as ArrayBuffer;
  } else {
    const response = await fetch(audioUrl);
    audioBuffer = await response.arrayBuffer();
  }

  const file = new File([audioBuffer], "audio.m4a", { type: "audio/m4a" });

  const transcription = await openai.audio.transcriptions.create({
    model: "whisper-1",
    file,
    response_format: "text",
  });

  return transcription as unknown as string;
}

async function analyzeTranscript(
  transcript: string,
  mode: string,
  knownPeople: { name: string; keywords: string[]; relationship: string }[] = [],
): Promise<AnalysisResult> {
  const modeInstructions: Record<string, string> = {
    general: "Extract commitments, people, topics, and notable quotes.",
    "1-on-1": "Focus on commitments between two people and relationship dynamics. Track who owes what.",
    "team_meeting": "Focus on action items, decisions made, and who is responsible for each.",
    interview: "Extract questions asked, key answers, and candidate/interviewer impressions.",
    brainstorm: "Capture ideas proposed (as topics) rather than commitments. Note who proposed each idea.",
    sales_call: "Track objections raised, next steps, deal signals, and competitive mentions.",
  };

  const knownPeopleContext = knownPeople.length > 0
    ? `\n## KNOWN PEOPLE (use these exact names when you recognize them):
${knownPeople.map(p => `- "${p.name}"${p.relationship ? ` (${p.relationship})` : ""}${p.keywords.length > 0 ? ` — keywords/aliases: ${p.keywords.join(", ")}` : ""}`).join("\n")}\n`
    : "";

  const prompt = `Analyze this conversation transcript. Mode: ${mode}.
${modeInstructions[mode] || modeInstructions.general}
${knownPeopleContext}
Return JSON with this exact structure:
{
  "title": "Short title (max 8 words)",
  "summary": "2-3 sentence summary",
  "sentiment": "one word: positive, negative, neutral, tense, excited, cautious",
  "commitments": [
    { "description": "What was promised", "owner": "me or them", "due_date": "ISO date or null", "person_name": "who this commitment involves or null" }
  ],
  "people": ["Every person or entity name mentioned — names, nicknames, titles, companies"],
  "topics": ["Key topics discussed, max 5, be specific"],
  "quotes": [
    { "text": "Notable or important quote", "speaker": "Person name" }
  ],
  "entities": [
    { "type": "PERSON|ORGANIZATION|PHONE|DATE|EMAIL|LOCATION", "text": "the entity", "context": "brief context of how it was mentioned" }
  ]
}

## ENTITY DETECTION (MANDATORY — never return empty)
You MUST identify ALL entities spoken in the transcript:
- PERSON: Every person name, nickname, or title ("Gary", "mom", "Dr. Smith")
- ORGANIZATION: Company names, brands, services ("Datel Software Solutions", "Starbucks")
- PHONE: Any phone numbers mentioned
- EMAIL: Any email addresses mentioned
- DATE: Any dates, times, or scheduling references ("tomorrow at 12:30", "next Tuesday")
- LOCATION: Places mentioned ("Oregon", "the office")

## PEOPLE DETECTION (CRITICAL)
Include ALL of these in the "people" array:
- Anyone addressed by name, nickname, or title (e.g., "mom", "Gary", "Dr. Smith")
- Anyone referred to in third person ("my boss", "Sarah from accounting")
- Organizations discussed as entities you'd want to track ("Datel Software Solutions")
- If someone is called "mom", "dad", "bro" etc., use that as their name unless you can match to a known person above

## RULES
- "me" = the person recording (first person). NEVER include "me", "myself", "I" in the people array.
- "them" = anyone else
- Only extract REAL commitments — actual promises, action items, or agreements. NOT vague intentions, hypotheticals, or pleasantries.
- Only extract genuinely notable quotes, max 3
- Topics should be specific ("Oregon flight booking" not "travel")
- For people: use the known person's exact name if detected by name or keywords.
- For commitments: set person_name to the specific person the commitment involves.

Transcript:
${transcript}`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "You are a conversation intelligence engine. You extract structured data, entities, and relationships from conversation transcripts. Always respond with valid JSON. Be thorough with entity detection — every name, number, date, and organization matters.",
      },
      { role: "user", content: prompt },
    ],
  });

  const result = JSON.parse(response.choices[0].message.content!) as AnalysisResult;
  result.entities = result.entities || [];
  result.people = result.people || [];
  return result;
}

async function findOrCreatePerson(userId: string, name: string) {
  const normalized = name.trim();
  const skip = ["unknown", "me", "myself", "i", "the user", "speaker", "recorder", ""];
  if (!normalized || skip.includes(normalized.toLowerCase())) return null;

  // Check exact match first
  const existing = await db
    .select()
    .from(people)
    .where(and(eq(people.userId, userId), eq(people.name, normalized)))
    .limit(1);

  if (existing.length > 0) return existing[0];

  // Check keywords match on existing people
  const allPeople = await db
    .select()
    .from(people)
    .where(eq(people.userId, userId));

  for (const p of allPeople) {
    if (p.keywords && p.keywords.some(k => k.toLowerCase() === normalized.toLowerCase())) {
      return p;
    }
  }

  const [created] = await db.insert(people).values({ userId, name: normalized }).returning();
  return created;
}
