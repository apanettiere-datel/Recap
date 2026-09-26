import { mkdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, sql } from "drizzle-orm";
import { db } from "./db.js";
import { notes, notePeople, people, tags, type MyNote } from "../models/schema.js";
import { enqueueNote, isNoteQueued } from "./processing.js";

export const UPLOADS_DIR = join(import.meta.dirname, "../../uploads");
export const MIN_AUDIO_BYTES = 1024;

export const CLIENT_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

export interface IngestOptions {
  userId: string;
  /** Idempotency key (the client's recording session id). */
  clientId: string | null;
  ext: string;
  mode: string;
  duration: number;
  personId: string | null;
  recordedAt: Date;
  /** Label the note, e.g. "recovered" for sessions finalized by the server. */
  tag?: string;
  /** Notes and bookmarks typed while recording. */
  myNotes?: MyNote[];
}

export type IngestResult =
  | { status: "created"; id: string }
  | { status: "duplicate"; id: string; processing: boolean }
  | { status: "replaced"; id: string };

export class IngestError extends Error {
  constructor(message: string, public httpStatus: 400 | 500 | 507 = 500) {
    super(message);
  }
}

export async function findNoteByClientId(userId: string, clientId: string) {
  const [existing] = await db
    .select({ id: notes.id, isProcessing: notes.isProcessing, audioUrl: notes.audioUrl })
    .from(notes)
    .where(and(eq(notes.userId, userId), sql`${notes.audioUrl} like ${`%/${userId}_${clientId}.%`}`))
    .limit(1);
  return existing ?? null;
}

async function sizeOf(path: string) {
  return (await stat(path).catch(() => null))?.size ?? 0;
}

/**
 * Turn an audio file on disk into a note and queue it for processing.
 *
 * Idempotent per clientId: repeating an upload returns the existing note, except that
 * a *larger* file for the same recording (e.g. the full local copy arriving after the
 * server already recovered a partial one) replaces the audio and re-transcribes.
 * `sourcePath` is moved into place (or deleted if it isn't needed).
 */
export async function ingestAudioFile(sourcePath: string, opts: IngestOptions): Promise<IngestResult> {
  const { userId, clientId } = opts;
  const incomingSize = await sizeOf(sourcePath);
  if (incomingSize < MIN_AUDIO_BYTES) {
    await unlink(sourcePath).catch(() => {});
    throw new IngestError("The recording is empty — no audio was captured.", 400);
  }

  if (clientId) {
    const existing = await findNoteByClientId(userId, clientId);
    if (existing) {
      const existingPath = fileURLToPath(existing.audioUrl);
      const existingSize = await sizeOf(existingPath);
      if (incomingSize > existingSize + 1024 && !isNoteQueued(existing.id)) {
        await rename(sourcePath, existingPath);
        await db
          .update(notes)
          .set({
            isProcessing: true, processingError: null, processingStage: "Queued", processingStartedAt: null, duration: opts.duration || 0,
            ...(opts.myNotes?.length ? { myNotes: opts.myNotes } : {}),
          })
          .where(eq(notes.id, existing.id));
        enqueueNote(existing.id, userId, { retranscribe: true });
        console.log(`[ingest] replaced audio for ${existing.id} (${existingSize} → ${incomingSize} bytes)`);
        return { status: "replaced", id: existing.id };
      }
      await unlink(sourcePath).catch(() => {});
      // A retry may carry notes the first upload didn't have
      if (opts.myNotes?.length) {
        await db.update(notes).set({ myNotes: opts.myNotes }).where(and(eq(notes.id, existing.id), sql`${notes.myNotes} is null`));
      }
      return { status: "duplicate", id: existing.id, processing: existing.isProcessing };
    }
  }

  if (opts.personId) {
    const [owned] = await db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.id, opts.personId), eq(people.userId, userId)))
      .limit(1);
    if (!owned) opts.personId = null;
  }

  const filePath = join(UPLOADS_DIR, `${userId}_${clientId ?? Date.now()}.${opts.ext}`);
  try {
    await mkdir(UPLOADS_DIR, { recursive: true });
    await rename(sourcePath, filePath);
  } catch (err) {
    console.error("[ingest] failed to store audio:", err);
    throw new IngestError("The server couldn't save your recording. Please retry.", 507);
  }

  let noteId: string;
  try {
    const [note] = await db
      .insert(notes)
      .values({
        userId,
        audioUrl: `file://${filePath}`,
        duration: opts.duration,
        conversationMode: opts.mode,
        recordedAt: opts.recordedAt,
        isProcessing: true,
        myNotes: opts.myNotes?.length ? opts.myNotes : null,
      })
      .returning({ id: notes.id });
    noteId = note.id;

    if (opts.personId) {
      await db.insert(notePeople).values({ noteId, personId: opts.personId });
      await db.update(people).set({ lastContactDate: opts.recordedAt }).where(eq(people.id, opts.personId));
    }
    if (opts.tag) {
      await db.insert(tags).values({ userId, noteId, label: opts.tag });
    }
  } catch (err) {
    console.error("[ingest] failed to create note:", err);
    await unlink(filePath).catch(() => {});
    throw new IngestError("The server couldn't save your recording. Please retry.");
  }

  enqueueNote(noteId, userId);
  return { status: "created", id: noteId };
}

/** Write a buffer to a temp file next to the uploads dir, for ingestAudioFile. */
export async function writeTempUpload(buffer: Buffer): Promise<string> {
  const dir = join(UPLOADS_DIR, "tmp");
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${Date.now()}_${Math.random().toString(36).slice(2)}.part`);
  await writeFile(path, buffer);
  return path;
}
