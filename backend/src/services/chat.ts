import OpenAI from "openai";
import { db } from "./db.js";
import { notes, commitments, people, topics, notePeople } from "../models/schema.js";
import { eq, and, desc } from "drizzle-orm";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function chatWithNotes(userId: string, userMessage: string): Promise<string> {
  const userNotes = await db
    .select()
    .from(notes)
    .where(and(eq(notes.userId, userId), eq(notes.isProcessing, false)))
    .orderBy(desc(notes.recordedAt))
    .limit(50);

  const userPeople = await db
    .select()
    .from(people)
    .where(eq(people.userId, userId));

  const userCommitments = await db
    .select()
    .from(commitments)
    .where(eq(commitments.userId, userId));

  const notesContext = userNotes
    .map((n) => {
      const noteCommitments = userCommitments
        .filter((c) => c.noteId === n.id)
        .map((c) => `  - [${c.owner}] ${c.description} (${c.status}${c.dueDate ? `, due ${c.dueDate.toLocaleDateString()}` : ""})`)
        .join("\n");

      return `## ${n.title} (${n.recordedAt.toLocaleDateString()})
Sentiment: ${n.sentiment}
Summary: ${n.summary}
${noteCommitments ? `Commitments:\n${noteCommitments}` : ""}`;
    })
    .join("\n\n");

  const peopleContext = userPeople
    .map((p) => {
      const openCount = userCommitments.filter(
        (c) => c.personId === p.id && c.status === "open"
      ).length;
      return `- ${p.name}: ${p.lastContactDate ? `last spoke ${p.lastContactDate.toLocaleDateString()}` : "no recent contact"}, ${openCount} open commitments`;
    })
    .join("\n");

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.3,
    messages: [
      {
        role: "system",
        content: `You are Recap's AI assistant. You help the user find information across their recorded conversations, track commitments, and understand relationship patterns.

IMPORTANT RULES:
- ONLY reference conversations, people, and commitments that appear in the data below. NEVER invent or hallucinate information.
- If the user asks about a person or topic not found in their data, say so clearly: "I don't see any conversations with [name] in your recordings" or "I couldn't find anything about that topic."
- If the user has no conversations recorded yet, tell them: "You don't have any recorded conversations yet. Start by recording a conversation and I'll be able to help you find information."
- Be concise and direct. Reference specific conversations by title and date when relevant.
- If you mention a specific note, format it as [Title, Date] so the app can link to it.

${userNotes.length === 0 ? "The user has NO recorded conversations yet." : `User's conversation history (${userNotes.length} conversations):\n${notesContext}`}

${userPeople.length === 0 ? "The user has NO people in their contacts yet." : `People the user talks to:\n${peopleContext}`}`,
      },
      { role: "user", content: userMessage },
    ],
  });

  return response.choices[0].message.content ?? "I couldn't find anything relevant.";
}
