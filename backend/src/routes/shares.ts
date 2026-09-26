import { Hono } from "hono";
import { randomBytes } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../services/db.js";
import { commitments, notePeople, notes, people, quotes, shares, topics } from "../models/schema.js";
import { AppEnv } from "../types.js";
import { sniffAudioFormat } from "../services/audio.js";
import { APP_URL } from "../services/digest.js";

const isUuid = (v: string | undefined) => !!v && /^[0-9a-f-]{36}$/i.test(v);
const shareUrl = (token: string) => `${APP_URL()}/s/${token}`;

/** Authenticated: manage share links for a note (mounted under /api/notes). */
export const shareAdmin = new Hono<AppEnv>();

shareAdmin.get("/:id/shares", async (c) => {
  const userId = c.get("userId");
  const noteId = c.req.param("id");
  if (!isUuid(noteId)) return c.json({ error: "Not found" }, 404);
  const rows = await db
    .select()
    .from(shares)
    .where(and(eq(shares.noteId, noteId), eq(shares.userId, userId), isNull(shares.revokedAt)))
    .orderBy(desc(shares.createdAt));
  return c.json(rows.map((s) => ({ ...s, url: shareUrl(s.token) })));
});

shareAdmin.post("/:id/shares", async (c) => {
  const userId = c.get("userId");
  const noteId = c.req.param("id");
  if (!isUuid(noteId)) return c.json({ error: "Not found" }, 404);
  const body = await c.req.json<{ includeAudio?: boolean; includeTranscript?: boolean }>().catch(() => ({} as { includeAudio?: boolean; includeTranscript?: boolean }));
  const [note] = await db.select({ id: notes.id, isProcessing: notes.isProcessing }).from(notes).where(and(eq(notes.id, noteId), eq(notes.userId, userId)));
  if (!note) return c.json({ error: "Not found" }, 404);
  if (note.isProcessing) return c.json({ error: "Wait for processing to finish before sharing." }, 409);
  const [share] = await db
    .insert(shares)
    .values({
      userId,
      noteId,
      token: randomBytes(24).toString("base64url"),
      includeAudio: !!body.includeAudio,
      includeTranscript: !!body.includeTranscript,
    })
    .returning();
  return c.json({ ...share, url: shareUrl(share.token) }, 201);
});

shareAdmin.delete("/:id/shares/:shareId", async (c) => {
  const userId = c.get("userId");
  const shareId = c.req.param("shareId");
  if (!isUuid(shareId)) return c.json({ error: "Not found" }, 404);
  await db.update(shares).set({ revokedAt: new Date() }).where(and(eq(shares.id, shareId), eq(shares.userId, userId)));
  return c.json({ ok: true });
});

/** Public, no login: GET /public/shares/:token and /public/shares/:token/audio */
export const sharePublic = new Hono();

async function activeShare(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const [row] = await db
    .select({ share: shares, note: notes })
    .from(shares)
    .innerJoin(notes, eq(shares.noteId, notes.id))
    .where(and(eq(shares.token, token), isNull(shares.revokedAt)));
  return row ?? null;
}

sharePublic.get("/shares/:token", async (c) => {
  const row = await activeShare(c.req.param("token"));
  if (!row) return c.json({ error: "This link is no longer available." }, 404);
  const { share, note } = row;

  const [noteCommitments, noteTopics, notePeopleRows, noteQuotes] = await Promise.all([
    db.select({ description: commitments.description, owner: commitments.owner, status: commitments.status, dueDate: commitments.dueDate, personName: people.name })
      .from(commitments).leftJoin(people, eq(commitments.personId, people.id)).where(eq(commitments.noteId, note.id)),
    db.select({ label: topics.label }).from(topics).where(eq(topics.noteId, note.id)),
    db.select({ name: people.name, relationship: people.relationship }).from(notePeople).innerJoin(people, eq(notePeople.personId, people.id)).where(eq(notePeople.noteId, note.id)),
    db.select({ text: quotes.text, speaker: quotes.speaker }).from(quotes).where(eq(quotes.noteId, note.id)),
  ]);

  await db.update(shares).set({ views: sql`${shares.views} + 1` }).where(eq(shares.id, share.id));

  c.header("Cache-Control", "no-store");
  c.header("X-Robots-Tag", "noindex");
  return c.json({
    title: note.title,
    meetingTitle: note.meetingTitle,
    summary: note.summary,
    sentiment: note.sentiment,
    recordedAt: note.recordedAt,
    duration: note.duration,
    commitments: noteCommitments,
    topics: noteTopics.map((t) => t.label),
    people: [...new Set(notePeopleRows.filter((p) => p.relationship !== "organization").map((p) => p.name))],
    quotes: noteQuotes,
    hasAudio: share.includeAudio && !!note.audioUrl,
    transcript: share.includeTranscript ? note.transcript : null,
    segments: share.includeTranscript ? note.segments : null,
    speakers: share.includeTranscript ? note.speakers : null,
  });
});

// Audio with HTTP Range support so browsers can seek
sharePublic.get("/shares/:token/audio", async (c) => {
  const row = await activeShare(c.req.param("token"));
  if (!row || !row.share.includeAudio || !row.note.audioUrl) return c.json({ error: "Not available" }, 404);
  const path = fileURLToPath(row.note.audioUrl);
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch {
    return c.json({ error: "Audio file not found" }, 404);
  }
  const data = await readFile(path);
  const { mime } = sniffAudioFormat(data.subarray(0, 16));
  const range = c.req.header("range");
  const headers: Record<string, string> = { "Content-Type": mime, "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=600", "X-Robots-Tag": "noindex" };
  const m = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (m) {
    let start = m[1] ? parseInt(m[1], 10) : size - parseInt(m[2] || "0", 10);
    let end = m[1] && m[2] ? parseInt(m[2], 10) : size - 1;
    if (Number.isNaN(start) || start < 0) start = 0;
    if (end >= size) end = size - 1;
    if (start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    return new Response(data.subarray(start, end + 1), {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }
  return new Response(data, { headers: { ...headers, "Content-Length": String(size) } });
});
