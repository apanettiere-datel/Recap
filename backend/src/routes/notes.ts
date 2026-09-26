import { Hono } from "hono";
import { db } from "../services/db.js";
import { notes, commitments, topics, people, notePeople, quotes, tags } from "../models/schema.js";
import { eq, and, desc, ilike, or, sql, inArray, gte, lte, getTableColumns, type SQL } from "drizzle-orm";
import { enqueueNote, isNoteQueued } from "../services/processing.js";
import { sniffAudioFormat } from "../services/audio.js";
import { writeFile, mkdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AppEnv } from "../types.js";

const UPLOADS_DIR = join(import.meta.dirname, "../../uploads");
const MIN_AUDIO_BYTES = 1024;

const app = new Hono<AppEnv>();

type NoteRow = typeof notes.$inferSelect;

/** Load commitments, topics, people, quotes and tags for many notes in 5 queries (not 5 per note). */
async function withRelations<T extends { id: string }>(rows: T[]) {
  if (rows.length === 0) return [];
  const ids = rows.map((n) => n.id);

  const [cRows, tRows, pRows, qRows, tagRows] = await Promise.all([
    db.select().from(commitments).where(inArray(commitments.noteId, ids)),
    db.select().from(topics).where(inArray(topics.noteId, ids)),
    db
      .select({ noteId: notePeople.noteId, person: people })
      .from(notePeople)
      .innerJoin(people, eq(notePeople.personId, people.id))
      .where(inArray(notePeople.noteId, ids)),
    db.select().from(quotes).where(inArray(quotes.noteId, ids)),
    db.select().from(tags).where(inArray(tags.noteId, ids)),
  ]);

  const group = <R>(list: R[], key: (r: R) => string | null) => {
    const map = new Map<string, R[]>();
    for (const r of list) {
      const k = key(r);
      if (!k) continue;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r);
    }
    return map;
  };

  const byC = group(cRows, (r) => r.noteId);
  const byT = group(tRows, (r) => r.noteId);
  const byP = group(pRows, (r) => r.noteId);
  const byQ = group(qRows, (r) => r.noteId);
  const byTag = group(tagRows, (r) => r.noteId);

  return rows.map((note) => {
    // The same person can be linked twice on older notes; dedupe for display
    const seen = new Set<string>();
    const notePeopleList = (byP.get(note.id) ?? [])
      .map((r) => r.person)
      .filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
    return {
      ...note,
      commitments: byC.get(note.id) ?? [],
      topics: (byT.get(note.id) ?? []).map((t) => t.label),
      people: notePeopleList,
      quotes: byQ.get(note.id) ?? [],
      tags: byTag.get(note.id) ?? [],
    };
  });
}

// List payloads skip the transcript (it can be ~100KB for a long recording)
const { transcript: _transcript, ...listColumns } = getTableColumns(notes);
const listSelection = {
  ...listColumns,
  transcriptLength: sql<number>`length(${notes.transcript})`.mapWith(Number),
};

function parseLimit(value: string | undefined, fallback: number, max: number) {
  const n = parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback;
}

function parseOffset(value: string | undefined) {
  const n = parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function extensionFor(file: File, header: Uint8Array): string {
  const type = (file.type || "").toLowerCase();
  if (type.includes("webm")) return "webm";
  if (type.includes("ogg")) return "ogg";
  if (type.includes("mp4") || type.includes("m4a") || type.includes("aac")) return "m4a";
  if (type.includes("mpeg") || type.includes("mp3")) return "mp3";
  if (type.includes("wav")) return "wav";
  return sniffAudioFormat(header).ext;
}

// Upload audio and start processing
app.post("/", async (c) => {
  const userId = c.get("userId") as string;

  let body: Record<string, string | File>;
  try {
    body = await c.req.parseBody();
  } catch (err) {
    console.error("[upload] could not parse body:", err);
    return c.json({ error: "The upload was incomplete or malformed. Please retry." }, 400);
  }

  const audio = body["audio"];
  const mode = typeof body["mode"] === "string" && body["mode"] ? body["mode"] : "general";
  const personId = typeof body["personId"] === "string" && body["personId"] ? body["personId"] : null;
  const duration = Math.max(0, parseFloat((body["duration"] as string) || "0") || 0);
  const clientId = typeof body["clientId"] === "string" && /^[A-Za-z0-9-]{8,64}$/.test(body["clientId"]) ? body["clientId"] : null;
  const recordedAtRaw = typeof body["recordedAt"] === "string" ? new Date(body["recordedAt"]) : null;
  const recordedAt = recordedAtRaw && !Number.isNaN(recordedAtRaw.getTime()) && recordedAtRaw.getTime() <= Date.now() + 60_000
    ? recordedAtRaw
    : new Date();

  if (!audio || typeof audio === "string") return c.json({ error: "No audio file was included in the upload." }, 400);
  if (audio.size < MIN_AUDIO_BYTES) return c.json({ error: "The recording is empty — no audio was captured." }, 400);

  // Idempotency: a retried upload (e.g. the response was lost) returns the original note
  if (clientId) {
    const [existing] = await db
      .select({ id: notes.id, isProcessing: notes.isProcessing })
      .from(notes)
      .where(and(eq(notes.userId, userId), sql`${notes.audioUrl} like ${`%/${userId}_${clientId}.%`}`))
      .limit(1);
    if (existing) {
      return c.json({ id: existing.id, status: existing.isProcessing ? "processing" : "done", duplicate: true }, 200);
    }
  }

  if (personId) {
    const [owned] = await db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.id, personId), eq(people.userId, userId)))
      .limit(1);
    if (!owned) return c.json({ error: "That person was not found." }, 400);
  }

  const buffer = Buffer.from(await audio.arrayBuffer());
  const ext = extensionFor(audio, buffer.subarray(0, 16));
  const filename = `${userId}_${clientId ?? Date.now()}.${ext}`;
  const filePath = join(UPLOADS_DIR, filename);

  try {
    await mkdir(UPLOADS_DIR, { recursive: true });
    await writeFile(filePath, buffer);
  } catch (err) {
    console.error("[upload] failed to save audio:", err);
    return c.json({ error: "The server couldn't save your recording. Please retry." }, 507);
  }

  let note: NoteRow;
  try {
    [note] = await db
      .insert(notes)
      .values({
        userId,
        audioUrl: `file://${filePath}`,
        duration,
        conversationMode: mode,
        recordedAt,
        isProcessing: true,
      })
      .returning();

    if (personId) {
      await db.insert(notePeople).values({ noteId: note.id, personId });
      await db.update(people).set({ lastContactDate: recordedAt }).where(eq(people.id, personId));
    }
  } catch (err) {
    console.error("[upload] failed to create note:", err);
    await unlink(filePath).catch(() => {});
    return c.json({ error: "The server couldn't save your recording. Please retry." }, 500);
  }

  enqueueNote(note.id, userId);

  return c.json({ id: note.id, status: "processing" }, 201);
});

// Create text note (no audio)
app.post("/text", async (c) => {
  const userId = c.get("userId") as string;
  const body = await c.req.json<{
    title: string;
    content: string;
    people?: string[];
  }>().catch(() => null);

  if (!body) return c.json({ error: "Invalid request body" }, 400);
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
    const owned = await db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.userId, userId), inArray(people.id, body.people)));
    if (owned.length) {
      await db.insert(notePeople).values(owned.map((p) => ({ noteId: note.id, personId: p.id })));
      await db
        .update(people)
        .set({ lastContactDate: new Date() })
        .where(inArray(people.id, owned.map((p) => p.id)));
    }
  }

  return c.json(note, 201);
});

// Get notes for user. `?archived=false` excludes archived notes (default: include, for older clients).
app.get("/", async (c) => {
  const userId = c.get("userId") as string;
  const limit = parseLimit(c.req.query("limit"), 50, 200);
  const offset = parseOffset(c.req.query("offset"));
  const archived = c.req.query("archived");

  const conditions: SQL[] = [eq(notes.userId, userId)];
  if (archived === "false") conditions.push(eq(notes.isArchived, false));

  const rows = await db
    .select(listSelection)
    .from(notes)
    .where(and(...conditions))
    .orderBy(desc(notes.recordedAt))
    .limit(limit)
    .offset(offset);

  return c.json(await withRelations(rows));
});

// Get archived notes
app.get("/archived", async (c) => {
  const userId = c.get("userId") as string;
  const limit = parseLimit(c.req.query("limit"), 50, 200);
  const offset = parseOffset(c.req.query("offset"));

  const rows = await db
    .select(listSelection)
    .from(notes)
    .where(and(eq(notes.userId, userId), eq(notes.isArchived, true)))
    .orderBy(desc(notes.recordedAt))
    .limit(limit)
    .offset(offset);

  return c.json(await withRelations(rows));
});

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/** Split a query into terms; "quoted phrases" stay together. */
function parseTerms(q: string): string[] {
  const terms: string[] = [];
  const re = /"([^"]+)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(q)) !== null) {
    const t = (m[1] ?? m[2]).trim();
    if (t && !terms.some((x) => x.toLowerCase() === t.toLowerCase())) terms.push(t);
  }
  return terms.slice(0, 8);
}

function likePattern(term: string) {
  return `%${term.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

function countOccurrences(haystack: string, needle: string) {
  if (!needle) return 0;
  let count = 0;
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    count++;
    i = haystack.indexOf(needle, i + needle.length);
  }
  return count;
}

/** Up to `max` short excerpts of the transcript around matches, trimmed to word boundaries. */
function buildSnippets(text: string, terms: string[], max = 3, radius = 90) {
  const lower = text.toLowerCase();
  const hits: number[] = [];
  for (const term of terms) {
    const t = term.toLowerCase();
    let i = lower.indexOf(t);
    while (i !== -1 && hits.length < 50) {
      hits.push(i);
      i = lower.indexOf(t, i + t.length);
    }
  }
  hits.sort((a, b) => a - b);

  const snippets: string[] = [];
  let lastEnd = -1;
  for (const hit of hits) {
    if (hit < lastEnd) continue;
    let start = Math.max(0, hit - radius);
    let end = Math.min(text.length, hit + radius);
    if (start > 0) {
      const space = text.indexOf(" ", start);
      if (space !== -1 && space < hit) start = space + 1;
    }
    if (end < text.length) {
      const space = text.lastIndexOf(" ", end);
      if (space > hit) end = space;
    }
    snippets.push(`${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`);
    lastEnd = end;
    if (snippets.length >= max) break;
  }
  return snippets;
}

async function searchNotes(userId: string, q: string, opts: {
  personId?: string | null;
  from?: Date | null;
  to?: Date | null;
  includeArchived?: boolean;
  limit?: number;
  offset?: number;
}) {
  const terms = parseTerms(q);
  if (terms.length === 0) return { terms, total: 0, notes: [], people: [], commitments: [] };

  const noteConditions: SQL[] = [eq(notes.userId, userId)];
  if (!opts.includeArchived) noteConditions.push(eq(notes.isArchived, false));
  if (opts.from) noteConditions.push(gte(notes.recordedAt, opts.from));
  if (opts.to) noteConditions.push(lte(notes.recordedAt, opts.to));
  if (opts.personId) {
    noteConditions.push(sql`exists (select 1 from ${notePeople} where ${notePeople.noteId} = ${notes.id} and ${notePeople.personId} = ${opts.personId})`);
  }

  // Every term must match somewhere: title, summary, transcript, a tag, a topic, or a linked person
  for (const term of terms) {
    const p = likePattern(term);
    noteConditions.push(or(
      ilike(notes.title, p),
      ilike(notes.summary, p),
      ilike(notes.transcript, p),
      sql`exists (select 1 from ${tags} where ${tags.noteId} = ${notes.id} and ${tags.label} ilike ${p})`,
      sql`exists (select 1 from ${topics} where ${topics.noteId} = ${notes.id} and ${topics.label} ilike ${p})`,
      sql`exists (select 1 from ${notePeople} np join ${people} pp on pp.id = np.person_id where np.note_id = ${notes.id} and pp.name ilike ${p})`,
    )!);
  }

  // Rank a bounded candidate set in memory: title > tags/people/topics > summary > transcript, then recency
  const candidates = await db
    .select()
    .from(notes)
    .where(and(...noteConditions))
    .orderBy(desc(notes.recordedAt))
    .limit(300);

  const enriched = await withRelations(candidates);
  const lowerTerms = terms.map((t) => t.toLowerCase());

  const scored = enriched.map((note) => {
    const title = (note.title || "").toLowerCase();
    const summary = (note.summary || "").toLowerCase();
    const transcript = (note.transcript || "").toLowerCase();
    const labels = [...note.tags.map((t) => t.label), ...note.topics, ...note.people.map((p) => p.name)].join(" ").toLowerCase();

    let transcriptMatches = 0;
    let score = 0;
    const matchedIn = new Set<string>();
    for (const t of lowerTerms) {
      if (title.includes(t)) { score += 10; matchedIn.add("title"); }
      if (labels.includes(t)) { score += 6; matchedIn.add("tags"); }
      if (summary.includes(t)) { score += 4; matchedIn.add("summary"); }
      const n = countOccurrences(transcript, t);
      if (n > 0) { score += Math.min(n, 10); matchedIn.add("transcript"); }
      transcriptMatches += n;
    }
    if (lowerTerms.length > 1 && transcript.includes(lowerTerms.join(" "))) score += 5;

    const { transcript: fullTranscript, ...rest } = note;
    return {
      note: {
        ...rest,
        transcriptLength: fullTranscript.length,
        matchedIn: [...matchedIn],
        transcriptMatches,
        // Text notes can have summary === transcript; don't repeat it as a snippet
        snippets: transcriptMatches > 0 && fullTranscript.trim() !== (note.summary || "").trim()
          ? buildSnippets(fullTranscript, terms)
          : [],
      },
      score,
      time: note.recordedAt.getTime(),
    };
  });

  scored.sort((a, b) => b.score - a.score || b.time - a.time);

  const limit = opts.limit ?? 30;
  const offset = opts.offset ?? 0;

  const personConditions = terms.map((t) => ilike(people.name, likePattern(t)));
  const commitmentConditions = terms.map((t) => ilike(commitments.description, likePattern(t)));

  const [matchingPeople, matchingCommitments] = await Promise.all([
    db
      .select()
      .from(people)
      .where(and(eq(people.userId, userId), or(...personConditions)))
      .limit(10),
    db
      .select()
      .from(commitments)
      .where(and(eq(commitments.userId, userId), ...commitmentConditions))
      .orderBy(desc(commitments.createdAt))
      .limit(10),
  ]);

  return {
    terms,
    total: scored.length,
    notes: scored.slice(offset, offset + limit).map((s) => s.note),
    people: matchingPeople,
    commitments: matchingCommitments,
  };
}

function parseDateParam(v: string | undefined) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Search: GET /notes/search?q=...&personId=&from=&to=&archived=include&limit=&offset=
app.get("/search", async (c) => {
  const userId = c.get("userId") as string;
  const q = (c.req.query("q") ?? "").trim().slice(0, 200);
  const result = await searchNotes(userId, q, {
    personId: c.req.query("personId") || null,
    from: parseDateParam(c.req.query("from")),
    to: parseDateParam(c.req.query("to")),
    includeArchived: c.req.query("archived") === "include",
    limit: parseLimit(c.req.query("limit"), 30, 100),
    offset: parseOffset(c.req.query("offset")),
  });
  return c.json({ query: q, ...result });
});

// Legacy search path used by the mobile app
app.get("/search/:query", async (c) => {
  const userId = c.get("userId") as string;
  const q = decodeURIComponent(c.req.param("query") ?? "").trim().slice(0, 200);
  const result = await searchNotes(userId, q, { includeArchived: true, limit: 20 });
  return c.json({ notes: result.notes, people: result.people, commitments: result.commitments });
});

// ---------------------------------------------------------------------------
// Single note
// ---------------------------------------------------------------------------

app.get("/:id", async (c) => {
  const userId = c.get("userId") as string;
  const noteId = c.req.param("id");
  if (!isUuid(noteId)) return c.json({ error: "Not found" }, 404);

  const [note] = await db
    .select()
    .from(notes)
    .where(and(eq(notes.id, noteId), eq(notes.userId, userId)));

  if (!note) return c.json({ error: "Not found" }, 404);

  const [withRel] = await withRelations([note]);
  return c.json({ ...withRel, isQueued: note.isProcessing ? isNoteQueued(note.id) : false });
});

// Update note (partial)
app.patch("/:id", async (c) => {
  const userId = c.get("userId") as string;
  const noteId = c.req.param("id");
  if (!isUuid(noteId)) return c.json({ error: "Not found" }, 404);
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return c.json({ error: "Invalid request body" }, 400);

  const updates: Record<string, unknown> = {};
  if (typeof body.title === "string") updates.title = body.title.trim().slice(0, 200);
  if (typeof body.summary === "string") updates.summary = body.summary;
  if (typeof body.isPinned === "boolean") updates.isPinned = body.isPinned;
  if (typeof body.isArchived === "boolean") updates.isArchived = body.isArchived;

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
  if (!isUuid(noteId)) return c.json({ error: "Not found" }, 404);

  const [note] = await db
    .select()
    .from(notes)
    .where(and(eq(notes.id, noteId), eq(notes.userId, userId)));

  if (!note) return c.json({ error: "Not found" }, 404);
  if (!note.audioUrl) return c.json({ error: "No audio" }, 404);

  try {
    const data = await readFile(fileURLToPath(note.audioUrl));
    // Detect actual format from magic bytes, not file extension
    const { mime } = sniffAudioFormat(data.subarray(0, 16));
    return new Response(data, {
      headers: {
        "Content-Type": mime,
        "Content-Length": data.byteLength.toString(),
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return c.json({ error: "Audio file not found" }, 404);
  }
});

// Reprocess a note. Body: { retranscribe?: boolean } — by default an existing transcript is reused.
app.post("/:id/reprocess", async (c) => {
  const userId = c.get("userId") as string;
  const noteId = c.req.param("id");
  if (!isUuid(noteId)) return c.json({ error: "Not found" }, 404);
  const body = await c.req.json<{ retranscribe?: boolean }>().catch(() => ({} as { retranscribe?: boolean }));

  const [note] = await db
    .select()
    .from(notes)
    .where(and(eq(notes.id, noteId), eq(notes.userId, userId)));

  if (!note) return c.json({ error: "Not found" }, 404);
  if (!note.audioUrl && !note.transcript.trim()) return c.json({ error: "Nothing to process" }, 400);
  if (isNoteQueued(noteId)) return c.json({ error: "This note is already being processed." }, 409);

  await db
    .update(notes)
    .set({ isProcessing: true, processingError: null, processingStage: "Queued", processingStartedAt: null })
    .where(eq(notes.id, noteId));

  enqueueNote(noteId, userId, { retranscribe: !!body?.retranscribe });

  return c.json({ id: noteId, status: "processing" });
});

// Delete note (and its audio file)
app.delete("/:id", async (c) => {
  const userId = c.get("userId") as string;
  const noteId = c.req.param("id");
  if (!isUuid(noteId)) return c.json({ error: "Not found" }, 404);

  const [deleted] = await db
    .delete(notes)
    .where(and(eq(notes.id, noteId), eq(notes.userId, userId)))
    .returning({ audioUrl: notes.audioUrl });

  if (deleted?.audioUrl?.startsWith("file://")) {
    await unlink(fileURLToPath(deleted.audioUrl)).catch(() => {});
  }
  return c.json({ ok: true });
});

// Add tag to note
app.post("/:id/tags", async (c) => {
  const userId = c.get("userId") as string;
  const noteId = c.req.param("id");
  if (!isUuid(noteId)) return c.json({ error: "Not found" }, 404);
  const body = await c.req.json<{ label: string }>().catch(() => null);
  const label = body?.label?.trim().slice(0, 50);

  if (!label) return c.json({ error: "Label required" }, 400);

  const [note] = await db
    .select({ id: notes.id })
    .from(notes)
    .where(and(eq(notes.id, noteId), eq(notes.userId, userId)));
  if (!note) return c.json({ error: "Not found" }, 404);

  const [existing] = await db
    .select()
    .from(tags)
    .where(and(eq(tags.noteId, noteId), sql`lower(${tags.label}) = ${label.toLowerCase()}`))
    .limit(1);
  if (existing) return c.json(existing, 200);

  const [tag] = await db
    .insert(tags)
    .values({ userId, noteId, label })
    .returning();

  return c.json(tag, 201);
});

// Remove tag from note
app.delete("/:id/tags/:tagId", async (c) => {
  const userId = c.get("userId") as string;
  const tagId = c.req.param("tagId");
  if (!isUuid(tagId)) return c.json({ error: "Not found" }, 404);

  await db.delete(tags).where(and(eq(tags.id, tagId), eq(tags.userId, userId)));
  return c.json({ ok: true });
});

function isUuid(v: string | undefined): v is string {
  return !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

export default app;
