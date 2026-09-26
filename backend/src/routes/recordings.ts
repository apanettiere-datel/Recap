import { Hono } from "hono";
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AppEnv } from "../types.js";
import { ingestAudioFile, IngestError, UPLOADS_DIR, CLIENT_ID_RE, findNoteByClientId } from "../services/ingest.js";
import { extensionFor, parseRecordedAt } from "./notes.js";

/**
 * Live cloud backup for recordings in progress.
 *
 * While recording, the client uploads the audio in numbered parts (every ~15s). The
 * parts concatenate into the full file, so on stop the client only has to send the
 * last few seconds and call /finalize. If the device dies mid-recording, the server
 * already holds everything up to the last part and finalizes it on its own.
 */

const SESSIONS_DIR = join(UPLOADS_DIR, "sessions");
const MAX_PART_BYTES = 40 * 1024 * 1024;
// A session with no new parts for this long is considered abandoned and recovered
export const ABANDONED_AFTER_MS = 30 * 60 * 1000;

interface SessionMeta {
  userId: string;
  sessionId: string;
  mimeType: string;
  mode: string;
  personId: string | null;
  recordedAt: string;
  duration: number;
}

const app = new Hono<AppEnv>();

function sessionDir(userId: string, sessionId: string) {
  return join(SESSIONS_DIR, `${userId}_${sessionId}`);
}

function partName(index: number) {
  return `${String(index).padStart(6, "0")}.part`;
}

async function listParts(dir: string): Promise<number[]> {
  const files = await readdir(dir).catch(() => [] as string[]);
  return files
    .filter((f) => f.endsWith(".part"))
    .map((f) => parseInt(f, 10))
    .filter((n) => Number.isInteger(n) && n >= 0)
    .sort((a, b) => a - b);
}

async function readMeta(dir: string): Promise<SessionMeta | null> {
  try {
    return JSON.parse(await readFile(join(dir, "meta.json"), "utf8"));
  } catch {
    return null;
  }
}

async function writeMeta(dir: string, meta: SessionMeta) {
  const tmp = join(dir, `meta.${Date.now()}.tmp`);
  await writeFile(tmp, JSON.stringify(meta));
  await rename(tmp, join(dir, "meta.json"));
}

function metaFromQuery(c: { req: { query: (k: string) => string | undefined } }, userId: string, sessionId: string): SessionMeta {
  const q = (k: string) => c.req.query(k) || "";
  return {
    userId,
    sessionId,
    mimeType: q("mime").slice(0, 100) || "audio/webm",
    mode: q("mode").slice(0, 40) || "conversation",
    personId: q("personId") || null,
    recordedAt: parseRecordedAt(q("recordedAt")).toISOString(),
    duration: Math.max(0, parseFloat(q("duration")) || 0),
  };
}

/** Concatenate parts [0..count) into one file and turn it into a note. */
async function assemble(meta: SessionMeta, dir: string, count: number, tag?: string) {
  const out = join(dir, `assembled.${Date.now()}`);
  const fh = await open(out, "w");
  let header: Buffer = Buffer.alloc(0);
  try {
    for (let i = 0; i < count; i++) {
      const data = await readFile(join(dir, partName(i)));
      if (i === 0) header = data.subarray(0, 16);
      await fh.write(data);
    }
  } finally {
    await fh.close();
  }

  const result = await ingestAudioFile(out, {
    userId: meta.userId,
    clientId: meta.sessionId,
    ext: extensionFor(meta.mimeType, header),
    mode: meta.mode,
    duration: meta.duration,
    personId: meta.personId,
    recordedAt: new Date(meta.recordedAt),
    tag,
  });
  await rm(dir, { recursive: true, force: true }).catch(() => {});
  return result;
}

// Upload one part: PUT /api/recordings/:sessionId/parts/:index?mime=&mode=&recordedAt=&personId=&duration=
app.put("/:sessionId/parts/:index", async (c) => {
  const userId = c.get("userId") as string;
  const sessionId = c.req.param("sessionId");
  const index = parseInt(c.req.param("index"), 10);
  if (!CLIENT_ID_RE.test(sessionId) || !Number.isInteger(index) || index < 0 || index > 100_000) {
    return c.json({ error: "Invalid recording part" }, 400);
  }

  const data = Buffer.from(await c.req.arrayBuffer());
  if (data.length === 0) return c.json({ error: "Empty part" }, 400);
  if (data.length > MAX_PART_BYTES) return c.json({ error: "Part too large" }, 413);

  // Already finalized (e.g. a late retry after the note was created)
  const existing = await findNoteByClientId(userId, sessionId);
  if (existing) return c.json({ ok: true, finalized: true, noteId: existing.id });

  const dir = sessionDir(userId, sessionId);
  await mkdir(dir, { recursive: true });

  const meta = metaFromQuery(c, userId, sessionId);
  const prev = await readMeta(dir);
  // Keep the original start time; take the latest known duration
  await writeMeta(dir, prev ? { ...prev, duration: Math.max(prev.duration, meta.duration) } : meta);

  // Atomic write so a half-received part is never mistaken for a complete one
  const tmp = join(dir, `${partName(index)}.${Date.now()}.tmp`);
  await writeFile(tmp, data);
  await rename(tmp, join(dir, partName(index)));

  return c.json({ ok: true, index, bytes: data.length });
});

// Which parts does the server have? GET /api/recordings/:sessionId
app.get("/:sessionId", async (c) => {
  const userId = c.get("userId") as string;
  const sessionId = c.req.param("sessionId");
  if (!CLIENT_ID_RE.test(sessionId)) return c.json({ error: "Not found" }, 404);
  const existing = await findNoteByClientId(userId, sessionId);
  if (existing) return c.json({ finalized: true, noteId: existing.id, parts: [] });
  return c.json({ finalized: false, parts: await listParts(sessionDir(userId, sessionId)) });
});

// Finish: POST /api/recordings/:sessionId/finalize { parts, duration, mode, personId, recordedAt, mimeType }
app.post("/:sessionId/finalize", async (c) => {
  const userId = c.get("userId") as string;
  const sessionId = c.req.param("sessionId");
  if (!CLIENT_ID_RE.test(sessionId)) return c.json({ error: "Not found" }, 404);
  const body = await c.req.json<{ parts?: number; duration?: number }>().catch(() => ({} as { parts?: number; duration?: number }));

  const existing = await findNoteByClientId(userId, sessionId);
  if (existing) return c.json({ id: existing.id, status: existing.isProcessing ? "processing" : "done", duplicate: true });

  const dir = sessionDir(userId, sessionId);
  const meta = await readMeta(dir);
  const have = new Set(await listParts(dir));
  const expected = Math.max(0, Math.floor(Number(body.parts) || 0));
  if (!meta || expected === 0) return c.json({ error: "No audio was received for this recording.", missing: [] }, 409);

  const missing: number[] = [];
  for (let i = 0; i < expected; i++) if (!have.has(i)) missing.push(i);
  if (missing.length > 0) return c.json({ error: "Some parts of the recording haven't arrived yet.", missing }, 409);

  if (typeof body.duration === "number" && body.duration > 0) meta.duration = body.duration;
  try {
    const result = await assemble(meta, dir, expected);
    return c.json({ id: result.id, status: "processing" }, result.status === "created" ? 201 : 200);
  } catch (err) {
    if (err instanceof IngestError) return c.json({ error: err.message }, err.httpStatus);
    throw err;
  }
});

// Throw a session away: DELETE /api/recordings/:sessionId
app.delete("/:sessionId", async (c) => {
  const userId = c.get("userId") as string;
  const sessionId = c.req.param("sessionId");
  if (!CLIENT_ID_RE.test(sessionId)) return c.json({ error: "Not found" }, 404);
  await rm(sessionDir(userId, sessionId), { recursive: true, force: true });
  return c.json({ ok: true });
});

/**
 * Recover recordings whose device went away mid-recording: any session with no new
 * parts for ABANDONED_AFTER_MS is assembled from its contiguous parts and processed.
 */
export async function recoverAbandonedSessions() {
  const dirs = await readdir(SESSIONS_DIR).catch(() => [] as string[]);
  const now = Date.now();
  for (const name of dirs) {
    const dir = join(SESSIONS_DIR, name);
    try {
      const parts = await listParts(dir);
      const meta = await readMeta(dir);
      let newest = 0;
      for (const f of await readdir(dir)) {
        newest = Math.max(newest, (await stat(join(dir, f))).mtimeMs);
      }
      if (now - newest < ABANDONED_AFTER_MS) continue;

      let contiguous = 0;
      while (parts.includes(contiguous)) contiguous++;
      if (!meta || contiguous === 0) {
        if (now - newest > 7 * 24 * 60 * 60 * 1000) await rm(dir, { recursive: true, force: true });
        continue;
      }
      const result = await assemble(meta, dir, contiguous, "recovered");
      console.log(`[recordings] recovered abandoned session ${name} (${contiguous} parts) → note ${result.id}`);
    } catch (err) {
      console.error(`[recordings] could not recover ${name}:`, err);
    }
  }
}

export default app;
