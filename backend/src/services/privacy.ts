import { readdir, rm, unlink } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, isNotNull, isNull, like, lt, sql } from "drizzle-orm";
import { db } from "./db.js";
import { notes, users } from "../models/schema.js";
import { UPLOADS_DIR } from "./ingest.js";
import { isNoteQueued } from "./processing.js";

/**
 * Privacy controls: deleting audio (on request or after a retention period) while
 * keeping transcripts and summaries, and deleting everything a user has.
 */

export const RETENTION_CHOICES = [7, 30, 90, 365] as const;

async function removeFile(audioUrl: string) {
  if (!audioUrl.startsWith("file://")) return;
  await unlink(fileURLToPath(audioUrl)).catch((err: NodeJS.ErrnoException) => {
    if (err.code !== "ENOENT") throw err;
  });
}

/** Delete one recording's audio; the transcript, summary and everything else stay. */
export async function deleteNoteAudio(noteId: string) {
  const [note] = await db.select({ audioUrl: notes.audioUrl, audioDeletedAt: notes.audioDeletedAt }).from(notes).where(eq(notes.id, noteId));
  if (!note || note.audioDeletedAt || !note.audioUrl) return false;
  await removeFile(note.audioUrl);
  // audio_url is kept: it identifies the recording session, so a late re-upload of the
  // same recording is still recognised as a duplicate
  await db.update(notes).set({ audioDeletedAt: new Date() }).where(eq(notes.id, noteId));
  return true;
}

/** Delete audio older than each user's retention period. Runs hourly. */
export async function purgeExpiredAudio(now = new Date()) {
  const subscribers = await db
    .select({ id: users.id, days: users.audioRetentionDays })
    .from(users)
    .where(isNotNull(users.audioRetentionDays));
  let removed = 0;
  for (const u of subscribers) {
    if (!u.days || u.days < 1) continue;
    const cutoff = new Date(now.getTime() - u.days * 86400000);
    const due = await db
      .select({ id: notes.id })
      .from(notes)
      .where(and(
        eq(notes.userId, u.id),
        lt(notes.recordedAt, cutoff),
        isNull(notes.audioDeletedAt),
        eq(notes.isProcessing, false),
        like(notes.audioUrl, "file://%"),
      ))
      .limit(500);
    for (const n of due) {
      if (isNoteQueued(n.id)) continue;
      try {
        if (await deleteNoteAudio(n.id)) removed++;
      } catch (err) {
        console.error(`[privacy] could not delete audio for ${n.id}:`, err);
      }
    }
  }
  if (removed) console.log(`[privacy] deleted audio for ${removed} recording(s) past their retention period`);
  return removed;
}

/**
 * Delete every recording file and database row for a user. With keepAccount the user
 * row stays (settings are reset) so they can carry on with an empty Recap.
 */
export async function deleteUserData(userId: string, { keepAccount }: { keepAccount: boolean }) {
  const audio = await db.select({ audioUrl: notes.audioUrl }).from(notes).where(and(eq(notes.userId, userId), sql`${notes.audioUrl} <> ''`));
  for (const a of audio) await removeFile(a.audioUrl).catch((e) => console.warn("[privacy] audio file removal failed:", (e as Error).message));

  // Recordings still being uploaded or waiting to be recovered
  const sessions = join(UPLOADS_DIR, "sessions");
  for (const name of await readdir(sessions).catch(() => [] as string[])) {
    if (name.startsWith(`${userId}_`)) await rm(join(sessions, name), { recursive: true, force: true }).catch(() => {});
  }
  for (const name of await readdir(UPLOADS_DIR).catch(() => [] as string[])) {
    if (name.startsWith(`${userId}_`)) await unlink(join(UPLOADS_DIR, name)).catch(() => {});
  }

  if (keepAccount) {
    // Every table cascades from notes/people/projects or references the user directly
    await db.transaction(async (tx) => {
      await tx.execute(sql`delete from notes where user_id = ${userId}`);
      await tx.execute(sql`delete from commitments where user_id = ${userId}`);
      await tx.execute(sql`delete from people where user_id = ${userId}`);
      await tx.execute(sql`delete from projects where user_id = ${userId}`);
      await tx.execute(sql`delete from insights where user_id = ${userId}`);
      await tx.execute(sql`delete from weekly_reports where user_id = ${userId}`);
      await tx.execute(sql`delete from calendar_events where user_id = ${userId}`);
      await tx.execute(sql`delete from note_chunks where user_id = ${userId}`);
      await tx.execute(sql`delete from shares where user_id = ${userId}`);
      await tx.update(users).set({
        vocabulary: [], calendarIcsUrl: null, calendarLastSyncAt: null, calendarError: null,
        todoistToken: null, notionToken: null, notionParentId: null, notionParentTitle: null,
        lastDigestSentAt: null, lastReminderDate: null,
      }).where(eq(users.id, userId));
    });
  } else {
    // Foreign keys cascade from users to everything else
    await db.delete(users).where(eq(users.id, userId));
  }
}

/** Remove the sign-in account itself (Clerk), so the user can't sign back into an empty shell. */
export async function deleteAuthAccount(authUserId: string): Promise<boolean> {
  const secret = process.env.CLERK_SECRET_KEY;
  if (!secret || !authUserId || authUserId.startsWith("dev-")) return false;
  const res = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(authUserId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok && res.status !== 404) throw new Error(`Clerk returned ${res.status}`);
  return true;
}
