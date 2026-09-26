import OpenAI from "openai";
import { and, desc, eq, gte, inArray, ne } from "drizzle-orm";
import { db } from "./db.js";
import { commitments, notePeople, notes, people, users } from "../models/schema.js";

export const APP_URL = () => (process.env.APP_URL || "https://personalrecap.com").replace(/\/$/, "");

export interface Digest {
  subject: string;
  html: string;
  text: string;
  stats: {
    conversations: number;
    minutes: number;
    people: number;
    commitmentsMade: number;
    commitmentsCompleted: number;
    overdue: number;
  };
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function fmtDate(d: Date, tz: string, opts: Intl.DateTimeFormatOptions) {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, ...opts }).format(d);
  } catch {
    return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...opts }).format(d);
  }
}

function fmtMinutes(seconds: number) {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} hr ${m % 60} min`;
}

async function narrative(input: string): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 20000, maxRetries: 1 });
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
      messages: [
        { role: "system", content: "You write a warm, specific, 2-3 sentence recap of someone's week of conversations for a weekly email. Mention names and concrete topics. No greeting, no bullet points." },
        { role: "user", content: input },
      ],
    });
    return res.choices[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.warn("[digest] narrative skipped:", (err as Error).message);
    return null;
  }
}

/** Build the weekly summary email for a user covering the 7 days before `now`. */
export async function buildDigest(userId: string, now = new Date()): Promise<Digest> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  const tz = user?.timezone || "UTC";
  const weekAgo = new Date(now.getTime() - 7 * 86400000);
  const weekAhead = new Date(now.getTime() + 7 * 86400000);
  const app = APP_URL();

  const weekNotes = await db
    .select({
      id: notes.id,
      title: notes.title,
      summary: notes.summary,
      duration: notes.duration,
      recordedAt: notes.recordedAt,
      isProcessing: notes.isProcessing,
    })
    .from(notes)
    .where(and(eq(notes.userId, userId), gte(notes.recordedAt, weekAgo), eq(notes.isArchived, false)))
    .orderBy(desc(notes.recordedAt));

  const noteIds = weekNotes.map((n) => n.id);
  const links = noteIds.length
    ? await db
        .select({ noteId: notePeople.noteId, name: people.name, relationship: people.relationship })
        .from(notePeople)
        .innerJoin(people, eq(notePeople.personId, people.id))
        .where(inArray(notePeople.noteId, noteIds))
    : [];
  const peopleByNote = new Map<string, string[]>();
  const uniquePeople = new Set<string>();
  for (const l of links) {
    if (l.relationship === "organization") continue;
    const list = peopleByNote.get(l.noteId) ?? [];
    if (!list.includes(l.name)) list.push(l.name);
    peopleByNote.set(l.noteId, list);
    uniquePeople.add(l.name);
  }

  const allCommitments = await db
    .select({
      id: commitments.id,
      description: commitments.description,
      owner: commitments.owner,
      status: commitments.status,
      dueDate: commitments.dueDate,
      createdAt: commitments.createdAt,
      completedAt: commitments.completedAt,
      noteId: commitments.noteId,
      personName: people.name,
    })
    .from(commitments)
    .leftJoin(people, eq(commitments.personId, people.id))
    .where(eq(commitments.userId, userId));

  const open = allCommitments.filter((c) => c.status !== "completed");
  const overdue = open.filter((c) => c.dueDate && c.dueDate < now).sort((a, b) => a.dueDate!.getTime() - b.dueDate!.getTime());
  const dueSoon = open.filter((c) => c.dueDate && c.dueDate >= now && c.dueDate <= weekAhead).sort((a, b) => a.dueDate!.getTime() - b.dueDate!.getTime());
  const made = allCommitments.filter((c) => c.createdAt >= weekAgo);
  const completed = allCommitments.filter((c) => c.completedAt && c.completedAt >= weekAgo);

  const fading = await db
    .select({ id: people.id, name: people.name, lastContactDate: people.lastContactDate })
    .from(people)
    .where(and(eq(people.userId, userId), ne(people.relationship, "organization")))
    .then((rows) =>
      rows
        .filter((p) => p.lastContactDate && now.getTime() - p.lastContactDate.getTime() > 14 * 86400000 && now.getTime() - p.lastContactDate.getTime() < 120 * 86400000)
        .sort((a, b) => b.lastContactDate!.getTime() - a.lastContactDate!.getTime())
        .slice(0, 5),
    );

  const minutes = weekNotes.reduce((s, n) => s + (n.duration || 0), 0);
  const stats = {
    conversations: weekNotes.length,
    minutes: Math.round(minutes / 60),
    people: uniquePeople.size,
    commitmentsMade: made.length,
    commitmentsCompleted: completed.length,
    overdue: overdue.length,
  };

  const story = weekNotes.length
    ? await narrative(
        weekNotes
          .slice(0, 25)
          .map((n) => `- ${fmtDate(n.recordedAt, tz, { weekday: "short" })}: ${n.title} (with ${(peopleByNote.get(n.id) ?? []).join(", ") || "no one named"}): ${n.summary}`)
          .join("\n") + `\nOpen commitments due this week: ${dueSoon.length}. Overdue: ${overdue.length}.`,
      )
    : null;

  const range = `${fmtDate(weekAgo, tz, { month: "short", day: "numeric" })} – ${fmtDate(now, tz, { month: "short", day: "numeric" })}`;
  const subject = weekNotes.length
    ? `Your week in conversations: ${weekNotes.length} recorded, ${stats.overdue ? `${stats.overdue} overdue` : `${dueSoon.length} due soon`}`
    : "Your Recap weekly summary";

  // Due dates are calendar dates stored at UTC midnight; format in UTC so they don't shift a day
  const due = (c: (typeof open)[number]) => (c.dueDate ? fmtDate(c.dueDate, "UTC", { weekday: "short", month: "short", day: "numeric" }) : "");
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const commitmentLine = (c: (typeof open)[number]) =>
    `${c.owner === "me" ? "You" : c.personName || "They"}: ${c.description}${c.dueDate ? ` (due ${due(c)})` : ""}`;

  // ---------- plain text ----------
  const text = [
    `Recap — your week (${range})`,
    "",
    `${plural(stats.conversations, "conversation", "conversations")} · ${fmtMinutes(minutes)} recorded · ${plural(stats.people, "person", "people")} · ${plural(stats.commitmentsMade, "commitment", "commitments")} made · ${stats.commitmentsCompleted} completed`,
    story ? `\n${story}` : "",
    overdue.length ? `\nOVERDUE\n${overdue.slice(0, 10).map((c) => `- ${commitmentLine(c)}`).join("\n")}` : "",
    dueSoon.length ? `\nDUE THIS WEEK\n${dueSoon.slice(0, 10).map((c) => `- ${commitmentLine(c)}`).join("\n")}` : "",
    weekNotes.length
      ? `\nCONVERSATIONS\n${weekNotes.slice(0, 12).map((n) => `- ${n.title || "Untitled"} (${fmtDate(n.recordedAt, tz, { weekday: "short", month: "short", day: "numeric" })})\n  ${n.summary || ""}\n  ${app}/note/${n.id}`).join("\n")}`
      : "\nNo conversations were recorded this week.",
    fading.length ? `\nRECONNECT\n${fading.map((p) => `- ${p.name} — last talked ${fmtDate(p.lastContactDate!, tz, { month: "short", day: "numeric" })}`).join("\n")}` : "",
    `\nOpen Recap: ${app}\nManage this email: ${app}/settings`,
  ].filter(Boolean).join("\n");

  // ---------- HTML ----------
  const section = (title: string, body: string) =>
    `<tr><td style="padding:24px 28px 0"><div style="font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#6b7280;margin-bottom:10px">${esc(title)}</div>${body}</td></tr>`;
  const stat = (value: string | number, label: string) =>
    `<td style="padding:12px 6px;text-align:center;background:#f5f5f7;border-radius:12px"><div style="font-size:22px;font-weight:700;color:#111827">${esc(value)}</div><div style="font-size:12px;color:#6b7280;margin-top:2px">${esc(label)}</div></td>`;
  const commitmentRows = (list: typeof open, color: string) =>
    list.slice(0, 10).map((c) => `<div style="padding:8px 0;border-bottom:1px solid #f0f0f2;font-size:14px;color:#111827"><span style="display:inline-block;width:8px;height:8px;border-radius:4px;background:${color};margin-right:8px"></span>${esc(commitmentLine(c))}</div>`).join("");

  const convRows = weekNotes.slice(0, 12).map((n) => {
    const who = peopleByNote.get(n.id) ?? [];
    return `<a href="${esc(`${app}/note/${n.id}`)}" style="display:block;text-decoration:none;padding:12px 14px;border:1px solid #e5e7eb;border-radius:14px;margin-bottom:10px">
      <div style="font-size:15px;font-weight:600;color:#111827">${esc(n.title || (n.isProcessing ? "New recording (processing)" : "Untitled"))}</div>
      <div style="font-size:12px;color:#6b7280;margin:3px 0 6px">${esc(fmtDate(n.recordedAt, tz, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))}${n.duration ? ` · ${esc(fmtMinutes(n.duration))}` : ""}${who.length ? ` · with ${esc(who.join(", "))}` : ""}</div>
      ${n.summary ? `<div style="font-size:14px;line-height:1.5;color:#374151">${esc(n.summary)}</div>` : ""}
      <div style="font-size:13px;color:#2563eb;margin-top:6px">Listen &amp; view analysis →</div>
    </a>`;
  }).join("");

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f2f2f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f7;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:20px;overflow:hidden">
  <tr><td style="padding:28px 28px 0">
    <div style="font-size:13px;font-weight:700;color:#ef4444">● Recap</div>
    <div style="font-size:24px;font-weight:700;color:#111827;margin-top:8px">Your week in conversations</div>
    <div style="font-size:14px;color:#6b7280;margin-top:4px">${esc(range)}</div>
  </td></tr>
  <tr><td style="padding:20px 22px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="6"><tr>
    ${stat(stats.conversations, stats.conversations === 1 ? "conversation" : "conversations")}${stat(fmtMinutes(minutes), "recorded")}${stat(stats.people, stats.people === 1 ? "person" : "people")}${stat(`${stats.commitmentsCompleted}/${stats.commitmentsMade}`, "done / made")}
  </tr></table></td></tr>
  ${story ? section("Week in review", `<div style="font-size:15px;line-height:1.6;color:#374151">${esc(story)}</div>`) : ""}
  ${overdue.length ? section(`Overdue (${overdue.length})`, commitmentRows(overdue, "#ef4444")) : ""}
  ${dueSoon.length ? section("Due in the next 7 days", commitmentRows(dueSoon, "#f59e0b")) : ""}
  ${section("Conversations", convRows || `<div style="font-size:14px;color:#6b7280">No conversations were recorded this week. <a href="${esc(`${app}/recording`)}" style="color:#2563eb">Record one</a>.</div>`)}
  ${fading.length ? section("Worth reconnecting with", fading.map((p) => `<div style="padding:6px 0;font-size:14px;color:#111827"><a href="${esc(`${app}/person/${p.id}`)}" style="color:#111827;text-decoration:none;font-weight:600">${esc(p.name)}</a> <span style="color:#6b7280">— last talked ${esc(fmtDate(p.lastContactDate!, tz, { month: "short", day: "numeric" }))}</span></div>`).join("")) : ""}
  <tr><td style="padding:28px">
    <a href="${esc(app)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 20px;border-radius:12px">Open Recap</a>
    <div style="font-size:12px;color:#9ca3af;margin-top:20px">You're receiving this because weekly summaries are on. <a href="${esc(`${app}/settings`)}" style="color:#6b7280">Change or turn off</a>.</div>
  </td></tr>
</table></td></tr></table></body></html>`;

  return { subject, html, text, stats };
}

/** The user's local weekday (0 = Sunday) and hour, in their timezone. */
export function localDayHour(now: Date, tz: string): { day: number; hour: number } {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(now);
    const wd = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
    const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
    return { day: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd), hour: hour % 24 };
  } catch {
    return { day: now.getUTCDay(), hour: now.getUTCHours() };
  }
}

export function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
