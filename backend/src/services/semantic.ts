import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "./db.js";
import { noteChunks, notePeople, notes, topics } from "../models/schema.js";
import { getOpenAI, withRetry } from "./ai.js";
import { myNotesText } from "./myNotes.js";

/**
 * Search by meaning. Each conversation is split into short passages (with speaker
 * names and start times) plus one title/summary passage; each passage gets an
 * embedding. Queries are embedded the same way and compared by cosine similarity.
 * Vectors live in a plain real[] column and are compared in memory (cached per user),
 * which is fast for one person's recordings and needs no database extension.
 */

const EMBED_MODEL = "text-embedding-3-small";
const DIMENSIONS = 512;
const PASSAGE_CHARS = 700;
const MIN_SCORE = 0.28;

export function semanticEnabled() {
  return !!process.env.OPENAI_API_KEY && process.env.SEMANTIC_SEARCH !== "off";
}

async function embed(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 64) {
    const batch = texts.slice(i, i + 64).map((t) => t.slice(0, 8000));
    const res = await withRetry("embed", () =>
      getOpenAI().embeddings.create({ model: EMBED_MODEL, input: batch, dimensions: DIMENSIONS, encoding_format: "float" }, { maxRetries: 0 }),
    );
    for (const d of res.data.sort((a, b) => a.index - b.index)) out.push(d.embedding.map((v) => Math.round(v * 1e5) / 1e5));
  }
  return out;
}

type NoteRow = typeof notes.$inferSelect;

function passagesFor(note: NoteRow, topicLabels: string[]): { start: number | null; text: string }[] {
  const out: { start: number | null; text: string }[] = [];
  const header = [
    note.title && `Title: ${note.title}`,
    note.meetingTitle && `Meeting: ${note.meetingTitle}`,
    note.summary && `Summary: ${note.summary}`,
    topicLabels.length && `Topics: ${topicLabels.join(", ")}`,
    note.myNotes?.length && `My notes:\n${myNotesText(note.myNotes).slice(0, 1500)}`,
  ].filter(Boolean).join("\n");
  if (header) out.push({ start: null, text: header });

  const speakers = note.speakers ?? {};
  if (note.segments?.length) {
    let buf = "";
    let start: number | null = null;
    let lastSpeaker = "";
    for (const seg of note.segments) {
      const name = seg.k ? speakers[seg.k] ?? `Speaker ${seg.k}` : "";
      if (buf && buf.length + seg.t.length > PASSAGE_CHARS) {
        out.push({ start, text: buf });
        buf = "";
        start = null;
        lastSpeaker = "";
      }
      const piece = name && name !== lastSpeaker ? `${name}: ${seg.t}` : seg.t;
      lastSpeaker = name;
      if (start === null) start = seg.s;
      buf += (buf ? " " : "") + piece;
    }
    if (buf) out.push({ start, text: buf });
  } else if (note.transcript?.trim()) {
    const text = note.transcript.trim();
    for (let i = 0; i < text.length; i += PASSAGE_CHARS) {
      out.push({ start: null, text: text.slice(i, i + PASSAGE_CHARS) });
    }
  }
  return out.slice(0, 600);
}

const cache = new Map<string, { at: number; rows: { id: string; noteId: string; start: number | null; text: string; v: Float32Array }[] }>();
const CACHE_TTL_MS = 10 * 60 * 1000;

/** (Re)build the passages and embeddings for one note. Safe to call repeatedly. */
export async function indexNote(noteId: string): Promise<number> {
  if (!semanticEnabled()) return 0;
  const [note] = await db.select().from(notes).where(eq(notes.id, noteId));
  if (!note || note.isProcessing) return 0;
  const topicLabels = (await db.select({ label: topics.label }).from(topics).where(eq(topics.noteId, noteId))).map((t) => t.label);
  const passages = passagesFor(note, topicLabels);
  const vectors = passages.length ? await embed(passages.map((p) => p.text)) : [];

  await db.transaction(async (tx) => {
    await tx.delete(noteChunks).where(eq(noteChunks.noteId, noteId));
    if (passages.length) {
      await tx.insert(noteChunks).values(passages.map((p, i) => ({
        noteId,
        userId: note.userId,
        start: p.start,
        text: p.text,
        embedding: vectors[i],
      })));
    }
  });
  cache.delete(note.userId);
  return passages.length;
}

/** Index notes that don't have passages yet (existing recordings, and anything that failed before). */
export async function backfillEmbeddings(limit = 200) {
  if (!semanticEnabled()) return;
  const missing = await db
    .select({ id: notes.id })
    .from(notes)
    .where(and(
      eq(notes.isProcessing, false),
      sql`length(${notes.transcript}) > 0 or length(${notes.summary}) > 0`,
      sql`not exists (select 1 from ${noteChunks} where ${noteChunks.noteId} = ${notes.id})`,
    ))
    .orderBy(desc(notes.recordedAt))
    .limit(limit);
  if (missing.length) console.log(`[semantic] indexing ${missing.length} conversation(s)`);
  for (const n of missing) {
    try {
      await indexNote(n.id);
    } catch (err) {
      console.warn(`[semantic] could not index ${n.id}:`, (err as Error).message);
      if ((err as { status?: number }).status === 401) return;
    }
  }
}

async function userVectors(userId: string) {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.rows;
  const rows = await db
    .select({ id: noteChunks.id, noteId: noteChunks.noteId, start: noteChunks.start, text: noteChunks.text, embedding: noteChunks.embedding })
    .from(noteChunks)
    .where(eq(noteChunks.userId, userId));
  const parsed = rows
    .filter((r) => r.embedding?.length)
    .map((r) => ({ id: r.id, noteId: r.noteId, start: r.start, text: r.text, v: Float32Array.from(r.embedding!) }));
  cache.set(userId, { at: Date.now(), rows: parsed });
  return parsed;
}

function cosine(a: Float32Array, b: number[]) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export interface PassageHit {
  noteId: string;
  start: number | null;
  text: string;
  score: number;
}

/** Most similar passages across a user's conversations. */
export async function searchPassages(userId: string, query: string, opts: { limit?: number; personId?: string | null; noteIds?: string[] | null; minScore?: number } = {}): Promise<PassageHit[]> {
  if (!semanticEnabled() || !query.trim()) return [];
  const rows = await userVectors(userId);
  if (rows.length === 0) return [];
  const [qv] = await embed([query]);

  let allowed: Set<string> | null = null;
  if (opts.personId) {
    allowed = new Set(
      (await db.select({ noteId: notePeople.noteId }).from(notePeople).where(eq(notePeople.personId, opts.personId))).map((r) => r.noteId),
    );
  }

  if (opts.noteIds) {
    const scope = new Set(opts.noteIds);
    allowed = allowed ? new Set([...allowed].filter((id) => scope.has(id))) : scope;
  }

  return rows
    .filter((r) => !allowed || allowed.has(r.noteId))
    .map((r) => ({ noteId: r.noteId, start: r.start, text: r.text, score: cosine(r.v, qv) }))
    .filter((r) => r.score >= (opts.minScore ?? MIN_SCORE))
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit ?? 30);
}

/** Conversations related by meaning, best passage per conversation. */
export async function semanticNotes(userId: string, query: string, opts: { limit?: number; personId?: string | null; includeArchived?: boolean } = {}) {
  const hits = await searchPassages(userId, query, { limit: 80, personId: opts.personId });
  const best = new Map<string, PassageHit>();
  for (const h of hits) if (!best.has(h.noteId)) best.set(h.noteId, h);
  const ids = [...best.keys()];
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: notes.id, title: notes.title, summary: notes.summary, recordedAt: notes.recordedAt, duration: notes.duration, sentiment: notes.sentiment, isArchived: notes.isArchived })
    .from(notes)
    .where(and(eq(notes.userId, userId), inArray(notes.id, ids)));
  return rows
    .filter((n) => opts.includeArchived || !n.isArchived)
    .map((n) => {
      const h = best.get(n.id)!;
      // The title/summary passage has no start time; don't show it as a quote
      return { ...n, score: Math.round(h.score * 1000) / 1000, passage: h.start != null ? h.text : null, start: h.start };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit ?? 8);
}
