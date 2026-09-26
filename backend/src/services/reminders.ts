import { and, eq, isNull, lte, gte } from "drizzle-orm";
import { db } from "./db.js";
import { commitments, notes, people, users } from "../models/schema.js";
import { APP_URL, localDayHour } from "./digest.js";
import { isEmailConfigured, sendEmail } from "./email.js";

/**
 * Commitment reminders: one email in the morning (the user's chosen hour, their
 * timezone) listing what they promised that's due today, plus anything that has
 * just become overdue. Each commitment is reminded at most once per state.
 */

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function localDate(now: Date, tz: string) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

type Row = { id: string; description: string; dueDate: Date | null; noteId: string | null; personName: string | null; noteTitle: string | null };

export async function buildReminder(userId: string, now = new Date()) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) return null;
  const today = localDate(now, user.timezone || "UTC");
  // Due dates are calendar dates stored at UTC midnight
  const dayStart = new Date(`${today}T00:00:00Z`);
  const dayEnd = new Date(`${today}T23:59:59Z`);

  const base = db
    .select({
      id: commitments.id,
      description: commitments.description,
      dueDate: commitments.dueDate,
      noteId: commitments.noteId,
      personName: people.name,
      noteTitle: notes.title,
    })
    .from(commitments)
    .leftJoin(people, eq(commitments.personId, people.id))
    .leftJoin(notes, eq(commitments.noteId, notes.id));

  const dueToday: Row[] = await base.where(and(
    eq(commitments.userId, userId), eq(commitments.owner, "me"), eq(commitments.status, "open"),
    gte(commitments.dueDate, dayStart), lte(commitments.dueDate, dayEnd), isNull(commitments.dueRemindedAt),
  ));
  const overdue: Row[] = await db
    .select({
      id: commitments.id,
      description: commitments.description,
      dueDate: commitments.dueDate,
      noteId: commitments.noteId,
      personName: people.name,
      noteTitle: notes.title,
    })
    .from(commitments)
    .leftJoin(people, eq(commitments.personId, people.id))
    .leftJoin(notes, eq(commitments.noteId, notes.id))
    .where(and(
      eq(commitments.userId, userId), eq(commitments.owner, "me"), eq(commitments.status, "open"),
      lte(commitments.dueDate, new Date(dayStart.getTime() - 1)), isNull(commitments.overdueRemindedAt),
    ));
  // Ignore very old items (usually stale dates from before reminders existed)
  const recentOverdue = overdue.filter((c) => c.dueDate && dayStart.getTime() - c.dueDate.getTime() < 30 * 86400000);

  if (dueToday.length === 0 && recentOverdue.length === 0) return { dueToday, overdue: recentOverdue, email: null };

  const app = APP_URL();
  const fmt = (d: Date | null) => (d ? new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(d) : "");
  const line = (c: Row) => `${c.description}${c.personName ? ` (for ${c.personName})` : ""}`;
  const subject = dueToday.length
    ? `Due today: ${dueToday.length === 1 ? dueToday[0].description.slice(0, 60) : `${dueToday.length} things you promised`}`
    : `${recentOverdue.length} commitment${recentOverdue.length === 1 ? " is" : "s are"} overdue`;

  const text = [
    dueToday.length ? `DUE TODAY\n${dueToday.map((c) => `- ${line(c)}`).join("\n")}` : "",
    recentOverdue.length ? `OVERDUE\n${recentOverdue.map((c) => `- ${line(c)} — was due ${fmt(c.dueDate)}`).join("\n")}` : "",
    `Mark them done: ${app}/commitments`,
  ].filter(Boolean).join("\n\n");

  const row = (c: Row, color: string, extra = "") => `<div style="padding:10px 0;border-bottom:1px solid #f0f0f2;font-size:15px;color:#111827">
    <span style="display:inline-block;width:8px;height:8px;border-radius:4px;background:${color};margin-right:8px"></span>${esc(line(c))}${extra}
    ${c.noteId ? `<div style="font-size:12px;margin:4px 0 0 16px"><a href="${esc(`${app}/note/${c.noteId}`)}" style="color:#2563eb;text-decoration:none">From “${esc(c.noteTitle || "conversation")}” →</a></div>` : ""}
  </div>`;
  const html = `<!doctype html><html><body style="margin:0;background:#f2f2f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;padding:24px 12px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:20px;padding:28px">
    <div style="font-size:13px;font-weight:700;color:#ef4444">● Recap · reminders</div>
    ${dueToday.length ? `<div style="font-size:20px;font-weight:700;color:#111827;margin:10px 0 6px">Due today</div>${dueToday.map((c) => row(c, "#f59e0b")).join("")}` : ""}
    ${recentOverdue.length ? `<div style="font-size:20px;font-weight:700;color:#111827;margin:18px 0 6px">Overdue</div>${recentOverdue.map((c) => row(c, "#ef4444", ` <span style="color:#9ca3af;font-size:13px">— was due ${esc(fmt(c.dueDate))}</span>`)).join("")}` : ""}
    <a href="${esc(`${app}/commitments`)}" style="display:inline-block;margin-top:20px;background:#2563eb;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 20px;border-radius:12px">Review commitments</a>
    <div style="font-size:12px;color:#9ca3af;margin-top:20px">You'll get one reminder per item. <a href="${esc(`${app}/settings`)}" style="color:#6b7280">Change reminder settings</a>.</div>
  </div></body></html>`;

  return { dueToday, overdue: recentOverdue, email: { subject, text, html } };
}

/** Hourly: send each user's reminder once per local day, at or after their chosen hour. */
export async function sendDueReminders(now = new Date()) {
  if (!isEmailConfigured()) return;
  const subscribers = await db.select().from(users).where(eq(users.remindersEnabled, true));
  for (const user of subscribers) {
    const to = user.digestEmail || user.email;
    if (!to) continue;
    const tz = user.timezone || "UTC";
    const today = localDate(now, tz);
    if (user.lastReminderDate === today) continue;
    if (localDayHour(now, tz).hour < user.reminderHour) continue;
    try {
      const built = await buildReminder(user.id, now);
      if (built?.email) {
        await sendEmail({ to, ...built.email });
        const at = new Date();
        for (const c of built.dueToday) await db.update(commitments).set({ dueRemindedAt: at }).where(eq(commitments.id, c.id));
        for (const c of built.overdue) await db.update(commitments).set({ overdueRemindedAt: at }).where(eq(commitments.id, c.id));
        console.log(`[reminders] sent to user ${user.id}: ${built.dueToday.length} due, ${built.overdue.length} overdue`);
      }
      await db.update(users).set({ lastReminderDate: today }).where(eq(users.id, user.id));
    } catch (err) {
      console.error(`[reminders] failed for user ${user.id} (will retry next hour):`, err);
    }
  }
}
