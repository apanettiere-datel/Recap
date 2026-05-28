import OpenAI from "openai";
import { readFile, writeFile, mkdtemp, rm, stat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { db } from "./db.js";
import { notes, commitments, topics, people, notePeople, quotes, tags } from "../models/schema.js";
import { eq, and } from "drizzle-orm";
import { generateInsights } from "./insights.js";

const execFileAsync = promisify(execFile);
const WHISPER_MAX_BYTES = 24 * 1024 * 1024; // 24MB (Whisper limit is 25MB)
const CHUNK_DURATION_SECS = 600; // 10-minute chunks

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
  tags: string[];
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

    const { transcript, chunkTranscripts } = await transcribeAudio(note.audioUrl);

    await db
      .update(notes)
      .set({ transcript })
      .where(eq(notes.id, noteId));

    const knownPeople = await db
      .select()
      .from(people)
      .where(eq(people.userId, userId));

    const analysis = chunkTranscripts.length > 1
      ? await analyzeChunkedTranscript(chunkTranscripts, note.conversationMode, knownPeople)
      : await analyzeTranscript(transcript, note.conversationMode, knownPeople);

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

    for (const label of (analysis.tags || [])) {
      await db.insert(tags).values({ userId, noteId, label });
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
    console.log(`[processNote] entities detected:`, JSON.stringify(analysis.entities?.map(e => `${e.type}:${e.text}`) || []));
    await enrichPeopleFromEntities(userId, noteId, analysis.entities, analysis.people);

    // Auto-generate insights after processing
    generateInsights(userId).catch((e) => console.error("[processNote] insights generation failed:", e));

  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await db
      .update(notes)
      .set({ isProcessing: false, processingError: message })
      .where(eq(notes.id, noteId));
  }
}

async function enrichPeopleFromEntities(userId: string, noteId: string, entities: Entity[], personNames: string[]) {
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

  for (const org of orgs) {
    const orgName = org.text.trim();
    if (!orgName) continue;

    // Attach org info to mentioned people
    if (personNames.length > 0) {
      for (const name of personNames) {
        const person = await findOrCreatePerson(userId, name);
        if (person && !person.organization) {
          await db.update(people).set({ organization: orgName }).where(eq(people.id, person.id));
        }
      }
    }

    // Create org as a trackable entity and link to note
    let [orgEntry] = await db
      .select()
      .from(people)
      .where(and(eq(people.userId, userId), eq(people.name, orgName)))
      .limit(1);
    if (!orgEntry) {
      [orgEntry] = await db.insert(people).values({
        userId,
        name: orgName,
        relationship: "organization",
        organization: orgName,
      }).returning();
    }
    if (orgEntry) {
      await db.insert(notePeople).values({ noteId, personId: orgEntry.id }).onConflictDoNothing();
    }
  }
}

interface TranscriptionResult {
  transcript: string;
  chunkTranscripts: string[];
}

async function transcribeAudio(audioUrl: string): Promise<TranscriptionResult> {
  let filePath: string;
  let filename = "audio.webm";

  if (audioUrl.startsWith("file://")) {
    filePath = audioUrl.slice(7);
    filename = filePath.split("/").pop() || filename;
  } else {
    const response = await fetch(audioUrl);
    const buffer = Buffer.from(await response.arrayBuffer());
    const tmpDir = await mkdtemp(join(tmpdir(), "recap-dl-"));
    filePath = join(tmpDir, filename);
    await writeFile(filePath, buffer);
  }

  const fileStats = await stat(filePath);

  if (fileStats.size <= WHISPER_MAX_BYTES) {
    const transcript = await transcribeSingleFile(filePath, filename);
    return { transcript, chunkTranscripts: [transcript] };
  }

  console.log(`[transcribe] File ${filename} is ${(fileStats.size / 1024 / 1024).toFixed(1)}MB — splitting into chunks`);
  return transcribeChunked(filePath, filename);
}

async function transcribeSingleFile(filePath: string, filename: string): Promise<string> {
  const audioBuffer = (await readFile(filePath)).buffer as ArrayBuffer;
  const ext = filename.split(".").pop() || "webm";
  const mimeType = ext === "webm" ? "audio/webm" : ext === "ogg" ? "audio/ogg" : "audio/mp4";
  const file = new File([audioBuffer], filename, { type: mimeType });

  const transcription = await openai.audio.transcriptions.create({
    model: "whisper-1",
    file,
    response_format: "text",
  });

  return transcription as unknown as string;
}

async function transcribeChunked(filePath: string, filename: string): Promise<TranscriptionResult> {
  const ext = filename.split(".").pop() || "webm";
  const chunkDir = await mkdtemp(join(tmpdir(), "recap-chunks-"));

  try {
    const chunkPattern = join(chunkDir, `chunk_%03d.${ext}`);
    await execFileAsync("ffmpeg", [
      "-i", filePath,
      "-f", "segment",
      "-segment_time", String(CHUNK_DURATION_SECS),
      "-c", "copy",
      "-reset_timestamps", "1",
      chunkPattern,
    ]);

    const files = await readdir(chunkDir);
    const chunkPaths = files
      .filter(f => f.startsWith("chunk_"))
      .sort()
      .map(f => join(chunkDir, f));

    if (chunkPaths.length === 0) {
      throw new Error("ffmpeg produced no output chunks");
    }

    console.log(`[transcribe] Split into ${chunkPaths.length} chunks, transcribing...`);

    const chunkTranscripts: string[] = [];
    for (const chunkPath of chunkPaths) {
      const chunkFilename = chunkPath.split("/").pop()!;
      const transcript = await transcribeSingleFile(chunkPath, chunkFilename);
      chunkTranscripts.push(transcript);
    }

    return { transcript: chunkTranscripts.join(" "), chunkTranscripts };
  } finally {
    await rm(chunkDir, { recursive: true, force: true }).catch(() => {});
  }
}

interface ChunkAnalysis {
  summary: string;
  commitments: { description: string; owner: string; due_date: string | null; person_name: string | null }[];
  people: string[];
  topics: string[];
  quotes: { text: string; speaker: string }[];
  entities: Entity[];
}

async function analyzeChunkedTranscript(
  chunkTranscripts: string[],
  mode: string,
  knownPeople: { name: string; keywords: string[]; relationship: string }[] = [],
): Promise<AnalysisResult> {
  const today = new Date().toISOString().split("T")[0];

  console.log(`[analyze] Map phase: summarizing ${chunkTranscripts.length} chunks...`);
  const chunkAnalyses: ChunkAnalysis[] = [];
  for (let i = 0; i < chunkTranscripts.length; i++) {
    const analysis = await summarizeChunk(chunkTranscripts[i], i + 1, chunkTranscripts.length, mode, today);
    chunkAnalyses.push(analysis);
  }

  console.log(`[analyze] Reduce phase: synthesizing final analysis...`);
  return synthesizeChunkAnalyses(chunkAnalyses, mode, knownPeople, today);
}

async function summarizeChunk(
  transcript: string,
  chunkNumber: number,
  totalChunks: number,
  mode: string,
  today: string,
): Promise<ChunkAnalysis> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "You extract structured data from a segment of a longer conversation transcript. Always respond with valid JSON.",
      },
      {
        role: "user",
        content: `This is segment ${chunkNumber} of ${totalChunks} from a longer recording (mode: ${mode}).
Today's date is ${today}.

Extract the following as JSON:
{
  "summary": "2-3 sentence summary of what was discussed in THIS segment",
  "commitments": [{ "description": "...", "owner": "me or them", "due_date": "ISO date or null", "person_name": "who this involves or null" }],
  "people": ["person names mentioned (humans only, not companies)"],
  "topics": ["specific topics discussed, max 5"],
  "quotes": [{ "text": "notable quote", "speaker": "person name" }],
  "entities": [{ "type": "PERSON|ORGANIZATION|PHONE|DATE|EMAIL|LOCATION", "text": "...", "context": "..." }]
}

Rules:
- Only real commitments, not vague intentions
- Convert relative dates to absolute dates based on ${today}
- "me"/"I" = the recorder, never include in people array
- Max 2 quotes per segment
- People array = humans only, organizations go in entities

Transcript segment:
${transcript}`,
      },
    ],
  });

  const result = JSON.parse(response.choices[0].message.content!) as ChunkAnalysis;
  result.entities = result.entities || [];
  result.people = result.people || [];
  return result;
}

async function synthesizeChunkAnalyses(
  chunks: ChunkAnalysis[],
  mode: string,
  knownPeople: { name: string; keywords: string[]; relationship: string }[] = [],
  today: string,
): Promise<AnalysisResult> {
  const knownPeopleContext = knownPeople.length > 0
    ? `\n## KNOWN PEOPLE (use these exact names when you recognize them):
${knownPeople.map(p => `- "${p.name}"${p.relationship ? ` (${p.relationship})` : ""}${p.keywords.length > 0 ? ` — keywords/aliases: ${p.keywords.join(", ")}` : ""}`).join("\n")}\n`
    : "";

  const chunksText = chunks.map((c, i) => `### Segment ${i + 1}
Summary: ${c.summary}
People: ${c.people.join(", ") || "none"}
Topics: ${c.topics.join(", ") || "none"}
Commitments: ${c.commitments.length > 0 ? c.commitments.map(cm => `${cm.description} (${cm.owner}${cm.person_name ? `, ${cm.person_name}` : ""}${cm.due_date ? `, due ${cm.due_date}` : ""})`).join("; ") : "none"}
Quotes: ${c.quotes.length > 0 ? c.quotes.map(q => `"${q.text}" — ${q.speaker}`).join("; ") : "none"}
Entities: ${c.entities.length > 0 ? c.entities.map(e => `${e.type}: ${e.text}`).join("; ") : "none"}`).join("\n\n");

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "You synthesize segment-level analyses of a long conversation into one cohesive final analysis. Deduplicate people, merge related topics, and keep only the most important quotes and commitments across the entire conversation. Always respond with valid JSON.",
      },
      {
        role: "user",
        content: `Below are analyses of ${chunks.length} consecutive segments from a long recording (mode: ${mode}).
Today's date is ${today}.
${knownPeopleContext}
Synthesize them into ONE final analysis as JSON:
{
  "title": "Short title for the entire conversation (max 8 words)",
  "summary": "3-5 sentence summary covering the full conversation arc",
  "sentiment": "overall sentiment: positive, negative, neutral, tense, excited, cautious",
  "commitments": [{ "description": "...", "owner": "me or them", "due_date": "ISO date or null", "person_name": "who this involves or null" }],
  "people": ["deduplicated list of all people mentioned (humans only)"],
  "topics": ["merged key topics across all segments, max 7"],
  "tags": ["3-5 short labels for categorizing this conversation"],
  "quotes": [{ "text": "most notable quote", "speaker": "person name" }],
  "entities": [{ "type": "PERSON|ORGANIZATION|PHONE|DATE|EMAIL|LOCATION", "text": "...", "context": "..." }]
}

Rules:
- Deduplicate people who appear in multiple segments
- Merge related/overlapping topics into broader ones
- Keep only the 3 most important quotes across ALL segments
- Include ALL commitments (don't drop any)
- Deduplicate entities but keep all unique ones
- Match people names to known people when possible
- The summary should tell the story of the whole conversation, not just list segment summaries

${chunksText}`,
      },
    ],
  });

  const result = JSON.parse(response.choices[0].message.content!) as AnalysisResult;
  result.entities = result.entities || [];
  result.people = result.people || [];
  result.tags = result.tags || [];
  return result;
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

  const today = new Date().toISOString().split("T")[0];

  const prompt = `Analyze this conversation transcript. Mode: ${mode}.
TODAY'S DATE: ${today}
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
  "people": ["Only actual PERSON names mentioned"],
  "topics": ["Key topics discussed, max 5, be specific"],
  "tags": ["3-5 short labels for categorizing this note, e.g. 'sales', 'follow-up', 'planning', 'hiring'"],
  "quotes": [
    { "text": "Notable or important quote", "speaker": "Person name" }
  ],
  "entities": [
    { "type": "PERSON|ORGANIZATION|PHONE|DATE|EMAIL|LOCATION", "text": "the entity", "context": "brief context of how it was mentioned" }
  ]
}

## DATE HANDLING (CRITICAL)
Today's date is ${today}. When someone says a relative date, convert it to an absolute ISO date:
- "next week" → the Monday of next week from ${today}
- "tomorrow" → the day after ${today}
- "end of month" → the last day of the current month
- "next Friday" → the next upcoming Friday from ${today}
- If a date is ambiguous or too vague to resolve, use null instead of guessing
- NEVER return dates in the past unless the speaker explicitly mentioned a past date

## ENTITY DETECTION (MANDATORY — never return empty)
You MUST identify ALL entities spoken in the transcript:
- PERSON: Every person name, nickname, or title ("Gary", "mom", "Dr. Smith")
- ORGANIZATION: Company names, brands, services ("Datel Software Solutions", "Starbucks")
- PHONE: Any phone numbers mentioned
- EMAIL: Any email addresses mentioned
- DATE: Any dates, times, or scheduling references ("tomorrow at 12:30", "next Tuesday")
- LOCATION: Places mentioned ("Oregon", "the office")

## PEOPLE vs ORGANIZATIONS (CRITICAL)
The "people" array must ONLY contain actual human beings — never companies, brands, or services.
- People: "Gary", "mom", "Dr. Smith", "Sarah from accounting"
- NOT people (put these ONLY in entities with type ORGANIZATION): "Rev.io", "DataGate", "Datel Software Solutions", "Google"
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
  result.tags = result.tags || [];
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
