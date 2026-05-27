import { Hono } from "hono";
import { db } from "../services/db.js";
import { notes, commitments, topics, people, notePeople, quotes, tags } from "../models/schema.js";
import { eq, and, desc, like, or, sql, inArray } from "drizzle-orm";
import { processNote } from "../services/processing.js";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AppEnv } from "../types.js";

const UPLOADS_DIR = join(import.meta.dirname, "../../uploads");

const app = new Hono<AppEnv>();

// Upload audio and start processing
app.post("/", async (c) => {
  const userId = c.get("userId") as string;
  const body = await c.req.parseBody();
  const audio = body["audio"] as File;
  const mode = (body["mode"] as string) ?? "general";
  const personId = (body["personId"] as string) || null;

  if (!audio) return c.json({ error: "No audio file" }, 400);

  // Save audio to local disk (preserve original format)
  await mkdir(UPLOADS_DIR, { recursive: true });
  const ext = audio.name?.endsWith(".webm") ? "webm" : audio.name?.split(".").pop() || "webm";
  const filename = `${userId}_${Date.now()}.${ext}`;
  const filePath = join(UPLOADS_DIR, filename);
  const buffer = Buffer.from(await audio.arrayBuffer());
  await writeFile(filePath, buffer);

  const audioUrl = `file://${filePath}`;

  const [note] = await db
    .insert(notes)
    .values({
      userId,
      audioUrl,
      duration: 0,
      conversationMode: mode,
    })
    .returning();

  if (personId) {
    await db.insert(notePeople).values({ noteId: note.id, personId });
    await db
      .update(people)
      .set({ lastContactDate: new Date() })
      .where(and(eq(people.id, personId), eq(people.userId, userId)));
  }

  // Process async
  processNote(note.id, userId).catch(console.error);

  return c.json({ id: note.id, status: "processing" }, 201);
});

// Create text note (no audio)
app.post("/text", async (c) => {
  const userId = c.get("userId") as string;
  const body = await c.req.json<{
    title: string;
    content: string;
    people?: string[];
  }>();

  if (!body.title?.trim()) return c.json({ error: "Title required" }, 400);
  if (!body.content?.trim()) return c.json({ error: "Content required" }, 400);

  const [note] = await db
    .insert(notes)
    .values({
      userId,
      title: body.title.trim(),
      transcript: body.content.trim(),
      summary: body.content.trim().length < 200 ? body.content.trim() : "",
      sentiment: "neutral",
      audioUrl: "",
      duration: 0,
      isProcessing: false,
    })
    .returning();

  if (body.people?.length) {
    await db.insert(notePeople).values(
      body.people.map((personId) => ({ noteId: note.id, personId }))
    );
    await db
      .update(people)
      .set({ lastContactDate: new Date() })
      .where(and(eq(people.userId, userId), inArray(people.id, body.people)));
  }

  return c.json(note, 201);
});

// Get all notes for user
app.get("/", async (c) => {
  const userId = c.get("userId") as string;
  const limit = parseInt(c.req.query("limit") ?? "50");
  const offset = parseInt(c.req.query("offset") ?? "0");

  const userNotes = await db
    .select()
    .from(notes)
    .where(eq(notes.userId, userId))
    .orderBy(desc(notes.recordedAt))
    .limit(limit)
    .offset(offset);

  const withRelations = await Promise.all(
    userNotes.map(async (note) => {
      const noteCommitments = await db
        .select()
        .from(commitments)
        .where(eq(commitments.noteId, note.id));

      const noteTopics = await db
        .select()
        .from(topics)
        .where(eq(topics.noteId, note.id));

      const notePeopleRows = await db
        .select({ person: people })
        .from(notePeople)
        .innerJoin(people, eq(notePeople.personId, people.id))
        .where(eq(notePeople.noteId, note.id));

      const noteQuotes = await db
        .select()
        .from(quotes)
        .where(eq(quotes.noteId, note.id));

      const noteTags = await db
        .select()
        .from(tags)
        .where(eq(tags.noteId, note.id));

      return {
        ...note,
        commitments: noteCommitments,
        topics: noteTopics.map((t) => t.label),
        people: notePeopleRows.map((r) => r.person),
        quotes: noteQuotes,
        tags: noteTags,
      };
    })
  );

  return c.json(withRelations);
});

// Get archived notes
app.get("/archived", async (c) => {
  const userId = c.get("userId") as string;
  const limit = parseInt(c.req.query("limit") ?? "50");
  const offset = parseInt(c.req.query("offset") ?? "0");

  const archivedNotes = await db
    .select()
    .from(notes)
    .where(and(eq(notes.userId, userId), eq(notes.isArchived, true)))
    .orderBy(desc(notes.recordedAt))
    .limit(limit)
    .offset(offset);

  const withRelations = await Promise.all(
    archivedNotes.map(async (note) => {
      const noteCommitments = await db
        .select()
        .from(commitments)
        .where(eq(commitments.noteId, note.id));

      const noteTopics = await db
        .select()
        .from(topics)
        .where(eq(topics.noteId, note.id));

      const notePeopleRows = await db
        .select({ person: people })
        .from(notePeople)
        .innerJoin(people, eq(notePeople.personId, people.id))
        .where(eq(notePeople.noteId, note.id));

      const noteQuotes = await db
        .select()
        .from(quotes)
        .where(eq(quotes.noteId, note.id));

      const noteTags = await db
        .select()
        .from(tags)
        .where(eq(tags.noteId, note.id));

      return {
        ...note,
        commitments: noteCommitments,
        topics: noteTopics.map((t) => t.label),
        people: notePeopleRows.map((r) => r.person),
        quotes: noteQuotes,
        tags: noteTags,
      };
    })
  );

  return c.json(withRelations);
});

// Get single note
app.get("/:id", async (c) => {
  const userId = c.get("userId") as string;
  const noteId = c.req.param("id");

  const [note] = await db
    .select()
    .from(notes)
    .where(and(eq(notes.id, noteId), eq(notes.userId, userId)));

  if (!note) return c.json({ error: "Not found" }, 404);

  const noteCommitments = await db.select().from(commitments).where(eq(commitments.noteId, noteId));
  const noteTopics = await db.select().from(topics).where(eq(topics.noteId, noteId));
  const notePeopleRows = await db
    .select({ person: people })
    .from(notePeople)
    .innerJoin(people, eq(notePeople.personId, people.id))
    .where(eq(notePeople.noteId, noteId));
  const noteQuotes = await db.select().from(quotes).where(eq(quotes.noteId, noteId));
  const noteTags = await db.select().from(tags).where(eq(tags.noteId, noteId));

  return c.json({
    ...note,
    commitments: noteCommitments,
    topics: noteTopics.map((t) => t.label),
    people: notePeopleRows.map((r) => r.person),
    quotes: noteQuotes,
    tags: noteTags,
  });
});

// Update note (partial)
app.patch("/:id", async (c) => {
  const userId = c.get("userId") as string;
  const noteId = c.req.param("id");
  const body = await c.req.json();

  const updates: Record<string, unknown> = {};
  if (body.title !== undefined) updates.title = body.title;
  if (body.summary !== undefined) updates.summary = body.summary;
  if (body.isPinned !== undefined) updates.isPinned = body.isPinned;
  if (body.isArchived !== undefined) updates.isArchived = body.isArchived;

  if (Object.keys(updates).length === 0) {
    return c.json({ error: "No fields to update" }, 400);
  }

  const [updated] = await db
    .update(notes)
    .set(updates)
    .where(and(eq(notes.id, noteId), eq(notes.userId, userId)))
    .returning();

  if (!updated) return c.json({ error: "Not found" }, 404);

  return c.json(updated);
});

// Serve audio file
app.get("/:id/audio", async (c) => {
  const userId = c.get("userId") as string;
  const noteId = c.req.param("id");

  const [note] = await db
    .select()
    .from(notes)
    .where(and(eq(notes.id, noteId), eq(notes.userId, userId)));

  if (!note) return c.json({ error: "Not found" }, 404);
  if (!note.audioUrl) return c.json({ error: "No audio" }, 404);

  try {
    const filePath = fileURLToPath(note.audioUrl);
    const data = await readFile(filePath);

    // Detect actual format from magic bytes, not file extension
    let contentType = "audio/mp4";
    if (data[0] === 0x1a && data[1] === 0x45 && data[2] === 0xdf && data[3] === 0xa3) {
      contentType = "audio/webm";
    } else if (data[0] === 0x4f && data[1] === 0x67 && data[2] === 0x67 && data[3] === 0x53) {
      contentType = "audio/ogg";
    } else if (data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46) {
      contentType = "audio/wav";
    }

    return new Response(data, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": data.byteLength.toString(),
        "Accept-Ranges": "bytes",
      },
    });
  } catch {
    return c.json({ error: "Audio file not found" }, 404);
  }
});

// Delete note
app.delete("/:id", async (c) => {
  const userId = c.get("userId") as string;
  const noteId = c.req.param("id");

  await db.delete(notes).where(and(eq(notes.id, noteId), eq(notes.userId, userId)));
  return c.json({ ok: true });
});

// Search across notes
app.get("/search/:query", async (c) => {
  const userId = c.get("userId") as string;
  const query = c.req.param("query");
  const pattern = `%${query}%`;

  const matchingNotes = await db
    .select()
    .from(notes)
    .where(
      and(
        eq(notes.userId, userId),
        or(
          like(notes.title, pattern),
          like(notes.summary, pattern),
          like(notes.transcript, pattern)
        )
      )
    )
    .orderBy(desc(notes.recordedAt))
    .limit(20);

  const matchingPeople = await db
    .select()
    .from(people)
    .where(and(eq(people.userId, userId), like(people.name, pattern)))
    .limit(10);

  const matchingCommitments = await db
    .select()
    .from(commitments)
    .where(and(eq(commitments.userId, userId), like(commitments.description, pattern)))
    .limit(10);

  return c.json({
    notes: matchingNotes,
    people: matchingPeople,
    commitments: matchingCommitments,
  });
});

// Add tag to note
app.post("/:id/tags", async (c) => {
  const userId = c.get("userId") as string;
  const noteId = c.req.param("id");
  const { label } = await c.req.json<{ label: string }>();

  if (!label?.trim()) return c.json({ error: "Label required" }, 400);

  // Verify note belongs to user
  const [note] = await db
    .select()
    .from(notes)
    .where(and(eq(notes.id, noteId), eq(notes.userId, userId)));
  if (!note) return c.json({ error: "Not found" }, 404);

  const [tag] = await db
    .insert(tags)
    .values({ userId, noteId, label: label.trim() })
    .returning();

  return c.json(tag, 201);
});

// Remove tag from note
app.delete("/:id/tags/:tagId", async (c) => {
  const userId = c.get("userId") as string;
  const tagId = c.req.param("tagId");

  await db.delete(tags).where(and(eq(tags.id, tagId), eq(tags.userId, userId)));
  return c.json({ ok: true });
});

export default app;
