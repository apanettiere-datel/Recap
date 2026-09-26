import { Hono } from "hono";
import { db } from "../services/db.js";
import { notes, commitments, topics, people, notePeople, quotes, tags, noteProjects, projects, users } from "../models/schema.js";
import { eq, and, desc, ilike, or, sql, inArray, gte, lte, getTableColumns, type SQL } from "drizzle-orm";
import { enqueueNote, isNoteQueued, draftFollowUp } from "../services/processing.js";
import { indexNote, semanticNotes } from "../services/semantic.js";
import { sniffAudioFormat } from "../services/audio.js";
import { readFile, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { AppEnv } from "../types.js";
import { ingestAudioFile, writeTempUpload, IngestError, MIN_AUDIO_BYTES, CLIENT_ID_RE } from "../services/ingest.js";
import { sanitizeMyNotes } from "../services/myNotes.js";
import { markStale } from "../services/projects.js";
import { deleteNoteAudio } from "../services/privacy.js";
import { loadExportNotes, toMarkdown, toDocx, toPdf, safeFilename } from "../services/export.js";

export function parseRecordedAt(v: unknown): Date {
  const d = typeof v === "string" ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) && d.getTime() <= Date.now() + 60_000 ? d : new Date();
}

const app = new Hono<AppEnv>();

type NoteRow = typeof notes.$inferSelect;

/** Load commitments, topics, people, quotes and tags for many notes in 5 queries (not 5 per note). */
async function withRelations<T extends { id: string }>(rows: T[]) {
  if (rows.length === 0) return [];
  const ids = rows.map((n) => n.id);

  const [cRows, tRows, pRows, qRows, tagRows, prRows] = await Promise.all([
    db.select().from(commitments).where(inArray(commitments.noteId, ids)),
    db.select().from(topics).where(inArray(topics.noteId, ids)),
    db
      .select({ noteId: notePeople.noteId, person: people })
      .from(notePeople)
      .innerJoin(people, eq(notePeople.personId, people.id))
      .where(inArray(notePeople.noteId, ids)),
    db.select().from(quotes).where(inArray(quotes.noteId, ids)),
    db.select().from(tags).where(inArray(tags.noteId, ids)),
    db
      .select({ noteId: noteProjects.noteId, auto: noteProjects.auto, id: projects.id, name: projects.name, color: projects.color })
      .from(noteProjects)
      .innerJoin(projects, eq(noteProjects.projectId, projects.id))
      .where(inArray(noteProjects.noteId, ids)),
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
  const byProject = group(prRows, (r) => r.noteId);

  return rows.map((note) => {
    // The same person can be linked twice on older notes; dedupe for display
    const seen = new Set<string>();
    const notePeopleList = (byP.get(note.id) ?? [])
      .map((r) => r.person)
      .filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
    const audioDeleted = !!(note as { audioDeletedAt?: Date | null }).audioDeletedAt;
    return {
      ...note,
      // Deleted audio: clients treat an empty audioUrl as "no audio"
      ...(audioDeleted ? { audioUrl: "" } : {}),
      projects: (byProject.get(note.id) ?? []).map(({ noteId: _n, ...p }) => p),
      commitments: byC.get(note.id) ?? [],
      topics: (byT.get(note.id) ?? []).map((t) => t.label),
      people: notePeopleList,
      quotes: byQ.get(note.id) ?? [],
      tags: byTag.get(note.id) ?? [],
    };
  });
}

// List payloads skip the transcript (it can be ~100KB for a long recording)
const { transcript: _transcript, segments: _segments, ...listColumns } = getTableColumns(notes);
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

export function extensionFor(file: { type?: string } | string, header: Uint8Array): string {
  const type = (typeof file === "string" ? file : file.type || "").toLowerCase();
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
  if (!audio || typeof audio === "string") return c.json({ error: "No audio file was included in the upload." }, 400);
  if (audio.size < MIN_AUDIO_BYTES) return c.json({ error: "The recording is empty — no audio was captured." }, 400);

  const clientId = typeof body["clientId"] === "string" && CLIENT_ID_RE.test(body["clientId"]) ? body["clientId"] : null;
  const buffer = Buffer.from(await audio.arrayBuffer());

  try {
    const tempPath = await writeTempUpload(buffer);
    const result = await ingestAudioFile(tempPath, {
      userId,
      clientId,
      ext: extensionFor(audio, buffer.subarray(0, 16)),
      mode: typeof body["mode"] === "string" && body["mode"] ? body["mode"] : "general",
      duration: Math.max(0, parseFloat((body["duration"] as string) || "0") || 0),
      personId: typeof body["personId"] === "string" && body["personId"] ? body["personId"] : null,
      recordedAt: parseRecordedAt(body["recordedAt"]),
      myNotes: sanitizeMyNotes(body["myNotes"]),
    });
    if (result.status === "duplicate") {
      return c.json({ id: result.id, status: result.processing ? "processing" : "done", duplicate: true }, 200);
    }
    return c.json({ id: result.id, status: "processing" }, result.status === "created" ? 201 : 200);
  } catch (err) {
    if (err instanceof IngestError) return c.json({ error: err.message }, err.httpStatus);
    throw err;
  }
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
      sql`${notes.myNotes}::text ilike ${p}`,
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
    const mine = (note.myNotes ?? []).map((n) => n.text).join(" ").toLowerCase();

    let transcriptMatches = 0;
    let score = 0;
    const matchedIn = new Set<string>();
    for (const t of lowerTerms) {
      if (title.includes(t)) { score += 10; matchedIn.add("title"); }
      if (labels.includes(t)) { score += 6; matchedIn.add("tags"); }
      if (summary.includes(t)) { score += 4; matchedIn.add("summary"); }
      if (mine.includes(t)) { score += 8; matchedIn.add("my notes"); }
      const n = countOccurrences(transcript, t);
      if (n > 0) { score += Math.min(n, 10); matchedIn.add("transcript"); }
      transcriptMatches += n;
    }
    if (lowerTerms.length > 1 && transcript.includes(lowerTerms.join(" "))) score += 5;

    const { transcript: fullTranscript, segments, ...rest } = note;
    return {
      note: {
        ...rest,
        // Timestamped matches, so a result can open the audio at that moment
        hits: transcriptMatches > 0 ? segmentHits(segments ?? [], lowerTerms) : [],
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

function segmentHits(segments: { s: number; e: number; t: string }[], lowerTerms: string[], max = 3) {
  const hits: { start: number; text: string }[] = [];
  for (const seg of segments) {
    const t = seg.t.toLowerCase();
    if (lowerTerms.some((term) => t.includes(term))) {
      hits.push({ start: seg.s, text: seg.t });
      if (hits.length >= max) break;
    }
  }
  return hits;
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

  // Conversations related by meaning that the keywords didn't find (first page only)
  let related: Awaited<ReturnType<typeof semanticNotes>> = [];
  if (c.req.query("semantic") === "1" && q.length >= 3 && parseOffset(c.req.query("offset")) === 0) {
    try {
      const from = parseDateParam(c.req.query("from"));
      const to = parseDateParam(c.req.query("to"));
      const shown = new Set(result.notes.map((n) => n.id));
      related = (await semanticNotes(userId, q, {
        limit: 12,
        personId: c.req.query("personId") || null,
        includeArchived: c.req.query("archived") === "include",
      }))
        .filter((n) => !shown.has(n.id))
        .filter((n) => (!from || n.recordedAt >= from) && (!to || n.recordedAt <= to))
        .slice(0, 8);
    } catch (err) {
      console.warn("[search] semantic search unavailable:", (err as Error).message);
    }
  }

  return c.json({ query: q, ...result, related });
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
  // Notes and bookmarks: { myNotes: [{ id, t, text, mark? }] } replaces the list
  if (Array.isArray(body.myNotes)) {
    const clean = sanitizeMyNotes(body.myNotes);
    updates.myNotes = clean.length ? clean : null;
  }

  // Rename speakers: { speakers: { "B": "Sarah" } }
  let renamed: [string, string][] = [];
  let previousSpeakers: Record<string, string> = {};
  if (body.speakers && typeof body.speakers === "object") {
    const [current] = await db.select({ segments: notes.segments, speakers: notes.speakers }).from(notes)
      .where(and(eq(notes.id, noteId), eq(notes.userId, userId)));
    if (!current) return c.json({ error: "Not found" }, 404);
    const labels = new Set((current.segments ?? []).map((s) => s.k).filter(Boolean));
    previousSpeakers = current.speakers ?? {};
    const next = { ...previousSpeakers };
    for (const [label, name] of Object.entries(body.speakers as Record<string, unknown>)) {
      if (!labels.has(label) || typeof name !== "string") continue;
      const clean = name.trim().slice(0, 80);
      if (!clean) continue;
      if (next[label] !== clean) renamed.push([previousSpeakers[label] ?? `Speaker ${label}`, clean]);
      next[label] = clean;
    }
    updates.speakers = next;
  }

  if (Object.keys(updates).length === 0) {
    return c.json({ error: "No fields to update" }, 400);
  }

  const [updated] = await db
    .update(notes)
    .set(updates)
    .where(and(eq(notes.id, noteId), eq(notes.userId, userId)))
    .returning();

  if (!updated) return c.json({ error: "Not found" }, 404);

  if (updates.myNotes !== undefined && !updated.isProcessing) indexNote(noteId).catch(() => {});

  if (renamed.length) {
    // Keep quotes attributed to the new name, and refresh search passages
    for (const [from, to] of renamed) {
      await db.update(quotes).set({ speaker: to }).where(and(eq(quotes.noteId, noteId), eq(quotes.speaker, from)));
    }
    indexNote(noteId).catch(() => {});
  }

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
  if (note.audioDeletedAt) return c.json({ error: "The audio for this recording was deleted." }, 410);

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
  if (body?.retranscribe && note.audioDeletedAt) return c.json({ error: "The audio was deleted, so this recording can't be re-transcribed." }, 400);
  if (isNoteQueued(noteId)) return c.json({ error: "This note is already being processed." }, 409);

  await db
    .update(notes)
    .set({ isProcessing: true, processingError: null, processingStage: "Queued", processingStartedAt: null })
    .where(eq(notes.id, noteId));

  enqueueNote(noteId, userId, { retranscribe: !!body?.retranscribe });

  return c.json({ id: noteId, status: "processing" });
});

// Draft a follow-up email: POST /notes/:id/follow-up { tone? }
app.post("/:id/follow-up", async (c) => {
  const userId = c.get("userId") as string;
  const noteId = c.req.param("id");
  if (!isUuid(noteId)) return c.json({ error: "Not found" }, 404);
  const body = await c.req.json<{ tone?: string }>().catch(() => ({} as { tone?: string }));

  const [note] = await db.select().from(notes).where(and(eq(notes.id, noteId), eq(notes.userId, userId)));
  if (!note) return c.json({ error: "Not found" }, 404);
  if (note.isProcessing) return c.json({ error: "Wait for processing to finish first." }, 409);
  if (!note.summary.trim() && !note.transcript.trim()) return c.json({ error: "There's nothing in this conversation to follow up on yet." }, 400);

  const [withRel] = await withRelations([note]);
  const humans = withRel.people.filter((p) => p.relationship !== "organization");
  const nameById = new Map(withRel.people.map((p) => [p.id, p.name]));

  try {
    const draft = await draftFollowUp({
      title: note.title,
      summary: note.summary,
      transcript: note.transcript,
      recipients: humans.map((p) => p.name),
      commitments: withRel.commitments.map((cm) => ({
        description: cm.description,
        owner: cm.owner,
        dueDate: cm.dueDate,
        person: cm.personId ? nameById.get(cm.personId) ?? null : null,
      })),
      tone: typeof body?.tone === "string" ? body.tone.slice(0, 60) : undefined,
    });
    return c.json({
      ...draft,
      to: humans.filter((p) => p.email).map((p) => ({ name: p.name, email: p.email })),
      missingEmails: humans.filter((p) => !p.email).map((p) => ({ id: p.id, name: p.name })),
    });
  } catch (err) {
    console.error("[follow-up] draft failed:", err);
    return c.json({ error: (err as Error).message?.startsWith("The draft") ? (err as Error).message : "Couldn't draft the email right now. Please try again." }, 502);
  }
});

// Delete note (and its audio file)
app.delete("/:id", async (c) => {
  const userId = c.get("userId") as string;
  const noteId = c.req.param("id");
  if (!isUuid(noteId)) return c.json({ error: "Not found" }, 404);

  const inProjects = (await db.select({ projectId: noteProjects.projectId }).from(noteProjects).where(eq(noteProjects.noteId, noteId)))
    .map((r) => r.projectId);
  const [deleted] = await db
    .delete(notes)
    .where(and(eq(notes.id, noteId), eq(notes.userId, userId)))
    .returning({ audioUrl: notes.audioUrl });

  if (deleted?.audioUrl?.startsWith("file://")) {
    await unlink(fileURLToPath(deleted.audioUrl)).catch(() => {});
  }
  if (deleted && inProjects.length) markStale(inProjects);
  return c.json({ ok: true });
});

// Delete only the audio, keeping transcript and analysis: DELETE /notes/:id/audio
app.delete("/:id/audio", async (c) => {
  const userId = c.get("userId") as string;
  const noteId = c.req.param("id");
  if (!isUuid(noteId)) return c.json({ error: "Not found" }, 404);
  const [note] = await db.select({ id: notes.id, isProcessing: notes.isProcessing }).from(notes).where(and(eq(notes.id, noteId), eq(notes.userId, userId)));
  if (!note) return c.json({ error: "Not found" }, 404);
  if (note.isProcessing || isNoteQueued(noteId)) return c.json({ error: "Wait for processing to finish first." }, 409);
  await deleteNoteAudio(noteId);
  return c.json({ ok: true });
});

// Download: GET /notes/:id/export?format=md|docx|pdf&transcript=1
app.get("/:id/export", async (c) => {
  const userId = c.get("userId") as string;
  const noteId = c.req.param("id");
  if (!isUuid(noteId)) return c.json({ error: "Not found" }, 404);
  const format = c.req.query("format") ?? "md";
  if (!["md", "docx", "pdf"].includes(format)) return c.json({ error: "Unknown format" }, 400);
  const [note] = await loadExportNotes(userId, [noteId]);
  if (!note) return c.json({ error: "Not found" }, 404);
  const [user] = await db.select({ timezone: users.timezone }).from(users).where(eq(users.id, userId));
  const tz = c.req.query("tz") || user?.timezone || "UTC";
  const opts = { transcript: c.req.query("transcript") === "1", timeZone: tz };

  let body: Buffer | string;
  let type: string;
  if (format === "docx") {
    body = await toDocx(note, opts);
    type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  } else if (format === "pdf") {
    body = await toPdf(note, opts);
    type = "application/pdf";
  } else {
    body = toMarkdown(note, opts);
    type = "text/markdown; charset=utf-8";
  }
  const filename = safeFilename(note.title, format);
  return new Response(typeof body === "string" ? body : new Uint8Array(body), {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
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
