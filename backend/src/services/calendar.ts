import https from "node:https";
import dns from "node:dns";
import net from "node:net";
import ICAL from "ical.js";
import { and, eq, gte, lte, isNull, isNotNull, sql, inArray } from "drizzle-orm";
import { db } from "./db.js";
import { calendarEvents, notePeople, notes, people, users, commitments, quotes, type Attendee } from "../models/schema.js";
import { APP_URL } from "./digest.js";
import { isEmailConfigured, sendEmail } from "./email.js";

/**
 * Calendar connection through the private ICS link every major calendar offers
 * (Google: "Secret address in iCal format"; Outlook: "Publish calendar → ICS";
 * iCloud: "Public calendar" link). Read-only, no OAuth app required.
 */

const MAX_ICS_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;
const WINDOW_PAST_MS = 3 * 86400000;
const WINDOW_FUTURE_MS = 14 * 86400000;

export class CalendarError extends Error {}

// ---------------------------------------------------------------------------
// Safe fetching of a user-supplied URL (blocks internal network targets)
// ---------------------------------------------------------------------------

function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  if (v6 === "::" || v6 === "::1") return true;
  if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7));
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v6);
}

/** DNS lookup that refuses private addresses — checked at connect time, so rebinding can't bypass it. */
const safeLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 4);
    const list = (addresses as dns.LookupAddress[]).filter((a) => !isPrivateAddress(a.address));
    if (list.length === 0) return callback(new CalendarError("That calendar address points to a private network."), "", 4);
    if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
    callback(null, list[0].address, list[0].family);
  });
};

export function normalizeIcsUrl(input: string): string {
  let raw = input.trim();
  if (/^webcals?:\/\//i.test(raw)) raw = raw.replace(/^webcals?:\/\//i, "https://");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new CalendarError("That doesn't look like a calendar link.");
  }
  if (url.protocol !== "https:") throw new CalendarError("Use the https:// (or webcal://) link for your calendar.");
  if (url.username || url.password) throw new CalendarError("Calendar links with embedded passwords aren't supported.");
  if (net.isIP(url.hostname) || /^localhost$/i.test(url.hostname) || url.hostname.endsWith(".local") || url.hostname.endsWith(".internal")) {
    throw new CalendarError("Use your calendar provider's public https link.");
  }
  return url.toString();
}

function fetchText(url: string, redirects = 3): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { lookup: safeLookup, timeout: FETCH_TIMEOUT_MS, headers: { "User-Agent": "Recap-Calendar/1.0", Accept: "text/calendar,*/*" } }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (redirects <= 0) return reject(new CalendarError("The calendar link redirected too many times."));
        try {
          return resolve(fetchText(normalizeIcsUrl(new URL(res.headers.location, url).toString()), redirects - 1));
        } catch (e) {
          return reject(e);
        }
      }
      if (status === 401 || status === 403 || status === 404) {
        res.resume();
        return reject(new CalendarError(`The calendar provider refused the link (HTTP ${status}). Copy the private/secret iCal address again.`));
      }
      if (status < 200 || status >= 300) {
        res.resume();
        return reject(new CalendarError(`The calendar provider returned HTTP ${status}.`));
      }
      let size = 0;
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => {
        size += c.length;
        if (size > MAX_ICS_BYTES) {
          req.destroy(new CalendarError("That calendar is too large to import."));
          return;
        }
        chunks.push(c);
      });
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new CalendarError("The calendar provider took too long to respond.")));
    req.on("error", (e) => reject(e instanceof CalendarError ? e : new CalendarError(`Couldn't reach the calendar: ${e.message}`)));
  });
}

// ---------------------------------------------------------------------------
// Parsing (with recurring events and per-occurrence exceptions)
// ---------------------------------------------------------------------------

export interface ParsedEvent {
  uid: string;
  start: Date;
  end: Date;
  title: string;
  location: string | null;
  attendees: Attendee[];
}

function attendeesOf(vevent: ICAL.Component): Attendee[] {
  const out: Attendee[] = [];
  const seen = new Set<string>();
  for (const prop of [...vevent.getAllProperties("attendee"), ...vevent.getAllProperties("organizer")]) {
    const cutype = String(prop.getParameter("cutype") ?? "").toUpperCase();
    if (cutype === "ROOM" || cutype === "RESOURCE") continue;
    const value = String(prop.getFirstValue() ?? "");
    const email = value.toLowerCase().startsWith("mailto:") ? value.slice(7).trim().toLowerCase() : null;
    const cn = String(prop.getParameter("cn") ?? "").trim().replace(/^"|"$/g, "");
    const name = cn && !cn.includes("@") ? cn : "";
    const key = email || name.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ name: name || (email ? email.split("@")[0] : ""), email });
  }
  return out.slice(0, 50);
}

export function parseIcs(text: string, from: Date, to: Date): ParsedEvent[] {
  let root: ICAL.Component;
  try {
    root = new ICAL.Component(ICAL.parse(text));
  } catch {
    throw new CalendarError("The link didn't return a valid calendar (.ics) file.");
  }
  for (const tz of root.getAllSubcomponents("vtimezone")) {
    try {
      ICAL.TimezoneService.register(tz);
    } catch {
      // ignore malformed timezone blocks
    }
  }

  const vevents = root.getAllSubcomponents("vevent");
  const masters = new Map<string, ICAL.Event>();
  const exceptions: ICAL.Event[] = [];
  for (const ve of vevents) {
    const ev = new ICAL.Event(ve);
    if (!ev.uid) continue;
    if (ev.isRecurrenceException()) exceptions.push(ev);
    else masters.set(ev.uid, ev);
  }
  for (const ex of exceptions) {
    const master = masters.get(ex.uid);
    if (master) master.relateException(ex);
    else masters.set(`${ex.uid}#${ex.recurrenceId?.toString()}`, ex);
  }

  const out: ParsedEvent[] = [];
  const push = (uid: string, ev: ICAL.Event, start: ICAL.Time, end: ICAL.Time) => {
    if (start.isDate) return; // all-day items aren't meetings
    if (String(ev.component.getFirstPropertyValue("status") ?? "").toUpperCase() === "CANCELLED") return;
    const s = start.toJSDate();
    const e = end ? end.toJSDate() : new Date(s.getTime() + 30 * 60000);
    if (e < from || s > to) return;
    out.push({
      uid: uid.slice(0, 500),
      start: s,
      end: e > s ? e : new Date(s.getTime() + 30 * 60000),
      title: String(ev.summary ?? "").trim().slice(0, 300),
      location: ev.location ? String(ev.location).slice(0, 300) : null,
      attendees: attendeesOf(ev.component),
    });
  };

  for (const [uid, ev] of masters) {
    try {
      if (ev.isRecurring()) {
        const it = ev.iterator();
        let next: ICAL.Time | null;
        let guard = 0;
        while ((next = it.next()) && guard++ < 2000) {
          if (next.toJSDate() > to) break;
          const occ = ev.getOccurrenceDetails(next);
          push(uid, occ.item, occ.startDate, occ.endDate);
        }
      } else {
        push(uid, ev, ev.startDate, ev.endDate);
      }
    } catch (err) {
      console.warn(`[calendar] skipped event ${uid}:`, (err as Error).message);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export async function syncCalendar(userId: string): Promise<{ events: number }> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user?.calendarIcsUrl) return { events: 0 };
  let text: string;
  try {
    text = await fetchText(user.calendarIcsUrl);
  } catch (err) {
    const message = err instanceof CalendarError ? err.message : `Calendar sync failed: ${(err as Error).message}`;
    await db.update(users).set({ calendarError: message }).where(eq(users.id, userId));
    throw err instanceof CalendarError ? err : new CalendarError(message);
  }
  return storeCalendar(userId, text);
}

/** Parse an ICS document and store its events in the sync window. */
export async function storeCalendar(userId: string, text: string): Promise<{ events: number }> {
  const now = Date.now();
  const from = new Date(now - WINDOW_PAST_MS);
  const to = new Date(now + WINDOW_FUTURE_MS);
  try {
    const events = parseIcs(text, from, to);

    for (const ev of events) {
      await db
        .insert(calendarEvents)
        .values({ userId, uid: ev.uid, startsAt: ev.start, endsAt: ev.end, title: ev.title, location: ev.location, attendees: ev.attendees })
        .onConflictDoUpdate({
          target: [calendarEvents.userId, calendarEvents.uid, calendarEvents.startsAt],
          set: { endsAt: ev.end, title: ev.title, location: ev.location, attendees: ev.attendees, updatedAt: new Date() },
        });
    }
    // Drop events in the window that were deleted or moved in the calendar
    const keep = events.map((e) => `${e.uid}|${e.start.toISOString()}`);
    const inWindow = await db
      .select({ id: calendarEvents.id, uid: calendarEvents.uid, startsAt: calendarEvents.startsAt })
      .from(calendarEvents)
      .where(and(eq(calendarEvents.userId, userId), gte(calendarEvents.startsAt, from), lte(calendarEvents.startsAt, to)));
    const stale = inWindow.filter((e) => !keep.includes(`${e.uid}|${e.startsAt.toISOString()}`)).map((e) => e.id);
    if (stale.length) {
      await db.update(notes).set({ calendarEventId: null }).where(inArray(notes.calendarEventId, stale));
      await db.delete(calendarEvents).where(inArray(calendarEvents.id, stale));
    }

    await db.update(users).set({ calendarLastSyncAt: new Date(), calendarError: null }).where(eq(users.id, userId));
    return { events: events.length };
  } catch (err) {
    const message = err instanceof CalendarError ? err.message : `Calendar sync failed: ${(err as Error).message}`;
    await db.update(users).set({ calendarError: message }).where(eq(users.id, userId));
    throw err instanceof CalendarError ? err : new CalendarError(message);
  }
}

export async function syncAllCalendars() {
  const connected = await db.select({ id: users.id }).from(users).where(isNotNull(users.calendarIcsUrl));
  for (const u of connected) {
    await syncCalendar(u.id).catch((e) => console.warn(`[calendar] sync failed for ${u.id}:`, (e as Error).message));
  }
}

// ---------------------------------------------------------------------------
// Matching recordings to meetings
// ---------------------------------------------------------------------------

export type CalendarEvent = typeof calendarEvents.$inferSelect;

/** The meeting a recording belongs to: started within its time (from 15 min before to its end). */
export async function findMeetingForRecording(userId: string, recordedAt: Date, durationSecs: number): Promise<CalendarEvent | null> {
  const startWindow = new Date(recordedAt.getTime() - 3 * 3600000);
  const candidates = await db
    .select()
    .from(calendarEvents)
    .where(and(eq(calendarEvents.userId, userId), gte(calendarEvents.startsAt, startWindow), lte(calendarEvents.startsAt, new Date(recordedAt.getTime() + 15 * 60000))));
  const recStart = recordedAt.getTime();
  const recEnd = recStart + Math.max(60, durationSecs || 0) * 1000;
  let best: CalendarEvent | null = null;
  let bestOverlap = 0;
  for (const ev of candidates) {
    const overlap = Math.min(recEnd, ev.endsAt.getTime()) - Math.max(recStart, ev.startsAt.getTime() - 15 * 60000);
    if (overlap > bestOverlap) {
      best = ev;
      bestOverlap = overlap;
    }
  }
  return best;
}

function selfEmails(user: typeof users.$inferSelect): Set<string> {
  return new Set([user.email, user.digestEmail].filter((e): e is string => !!e).map((e) => e.toLowerCase()));
}

/** Link a meeting's attendees to the note as people, creating or enriching contacts. */
export async function linkMeetingAttendees(userId: string, noteId: string, event: CalendarEvent) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) return;
  const mine = selfEmails(user);
  const existingLinks = new Set(
    (await db.select({ personId: notePeople.personId }).from(notePeople).where(eq(notePeople.noteId, noteId))).map((r) => r.personId),
  );
  for (const a of event.attendees) {
    if (a.email && mine.has(a.email)) continue;
    let [person] = a.email
      ? await db.select().from(people).where(and(eq(people.userId, userId), sql`lower(${people.email}) = ${a.email}`)).limit(1)
      : [];
    if (!person && a.name) {
      [person] = await db.select().from(people).where(and(eq(people.userId, userId), sql`lower(${people.name}) = ${a.name.toLowerCase()}`)).limit(1);
    }
    if (!person && a.name.includes(" ")) {
      // "Sarah Lee" in the calendar is the "Sarah" already in contacts — if that's unambiguous
      const first = a.name.split(/\s+/)[0].toLowerCase();
      const candidates = await db.select().from(people).where(and(
        eq(people.userId, userId),
        sql`lower(${people.name}) = ${first}`,
        sql`${people.relationship} <> 'organization'`,
        isNull(people.email),
      ));
      if (candidates.length === 1) {
        person = candidates[0];
        // Keep the short name as an alias so later mentions of "Sarah" still resolve here
        const keywords = [...new Set([...(person.keywords ?? []), person.name])];
        await db.update(people).set({ name: a.name, keywords }).where(eq(people.id, person.id));
      }
    }
    if (!person) {
      if (!a.name) continue;
      [person] = await db.insert(people).values({ userId, name: a.name, email: a.email }).returning();
    } else if (a.email && !person.email) {
      await db.update(people).set({ email: a.email }).where(eq(people.id, person.id));
    }
    if (!existingLinks.has(person.id)) {
      existingLinks.add(person.id);
      await db.insert(notePeople).values({ noteId, personId: person.id });
    }
  }
}

// ---------------------------------------------------------------------------
// Upcoming meetings and prep briefs
// ---------------------------------------------------------------------------

export async function upcomingMeetings(userId: string, days = 7) {
  const now = new Date();
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  const mine = user ? selfEmails(user) : new Set<string>();
  const events = await db
    .select()
    .from(calendarEvents)
    .where(and(eq(calendarEvents.userId, userId), gte(calendarEvents.endsAt, now), lte(calendarEvents.startsAt, new Date(now.getTime() + days * 86400000))))
    .orderBy(calendarEvents.startsAt)
    .limit(50);
  const everyone = await db.select({ id: people.id, name: people.name, email: people.email }).from(people).where(eq(people.userId, userId));
  const byEmail = new Map(everyone.filter((p) => p.email).map((p) => [p.email!.toLowerCase(), p]));
  const byName = new Map(everyone.map((p) => [p.name.toLowerCase(), p]));

  const matchedIds = new Set<string>();
  const withPeople = events.map((ev) => {
    const matched = ev.attendees
      .filter((a) => !(a.email && mine.has(a.email)))
      .map((a) => (a.email && byEmail.get(a.email)) || (a.name && byName.get(a.name.toLowerCase())) || null)
      .filter((p): p is (typeof everyone)[number] => !!p);
    matched.forEach((p) => matchedIds.add(p.id));
    return { ...ev, people: matched };
  });

  const counts = matchedIds.size
    ? await db
        .select({ personId: notePeople.personId, count: sql<number>`count(distinct ${notePeople.noteId})`.mapWith(Number) })
        .from(notePeople)
        .where(inArray(notePeople.personId, [...matchedIds]))
        .groupBy(notePeople.personId)
    : [];
  const countBy = new Map(counts.map((c) => [c.personId, c.count]));
  return withPeople.map((ev) => ({
    id: ev.id,
    title: ev.title,
    startsAt: ev.startsAt,
    endsAt: ev.endsAt,
    location: ev.location,
    attendees: ev.attendees.filter((a) => !(a.email && mine.has(a.email))),
    people: ev.people.map((p) => ({ id: p.id, name: p.name, conversations: countBy.get(p.id) ?? 0 })),
  }));
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Build a pre-meeting brief for the people you've talked to before. Null if there's nothing to say. */
export async function buildPrepBrief(userId: string, event: CalendarEvent) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  const tz = user?.timezone || "UTC";
  const meeting = (await upcomingMeetings(userId, 14)).find((m) => m.id === event.id);
  const known = (meeting?.people ?? []).filter((p) => p.conversations > 0);
  if (known.length === 0) return null;
  const app = APP_URL();

  const sections: { html: string; text: string }[] = [];
  for (const p of known.slice(0, 5)) {
    const recent = await db
      .select({ id: notes.id, title: notes.title, summary: notes.summary, recordedAt: notes.recordedAt })
      .from(notePeople)
      .innerJoin(notes, eq(notePeople.noteId, notes.id))
      .where(and(eq(notePeople.personId, p.id), eq(notes.isProcessing, false)))
      .orderBy(sql`${notes.recordedAt} desc`)
      .limit(3);
    const open = await db
      .select({ description: commitments.description, owner: commitments.owner, dueDate: commitments.dueDate })
      .from(commitments)
      .where(and(eq(commitments.personId, p.id), eq(commitments.status, "open")))
      .limit(8);
    const said = await db
      .select({ text: quotes.text })
      .from(quotes)
      .where(eq(quotes.personId, p.id))
      .orderBy(sql`${quotes.createdAt} desc`)
      .limit(2);

    const fmt = (d: Date) => new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" }).format(d);
    const lastLine = recent[0] ? `Last talked ${fmt(recent[0].recordedAt)}: ${recent[0].title}` : "";
    const commitmentLine = (c: (typeof open)[number]) => `${c.owner === "me" ? "You owe" : `${p.name} owes`}: ${c.description}${c.dueDate ? ` (due ${new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(c.dueDate)})` : ""}`;

    sections.push({
      text: [
        `${p.name.toUpperCase()} (${p.conversations} conversation${p.conversations === 1 ? "" : "s"})`,
        lastLine,
        ...recent.slice(0, 2).map((n) => `- ${n.title}: ${n.summary}`),
        ...(open.length ? ["Open items:", ...open.map((c) => `- ${commitmentLine(c)}`)] : []),
        ...said.map((q) => `"${q.text}"`),
        `Full prep: ${app}/briefing/${p.id}`,
      ].filter(Boolean).join("\n"),
      html: `<div style="padding:16px 0;border-top:1px solid #eee">
        <div style="font-size:16px;font-weight:700;color:#111827">${esc(p.name)} <span style="font-weight:400;color:#6b7280;font-size:13px">· ${p.conversations} conversation${p.conversations === 1 ? "" : "s"}</span></div>
        ${recent.slice(0, 2).map((n) => `<div style="margin-top:8px;font-size:14px;color:#374151"><a href="${esc(`${app}/note/${n.id}`)}" style="color:#2563eb;text-decoration:none;font-weight:600">${esc(n.title)}</a> <span style="color:#9ca3af">${esc(fmt(n.recordedAt))}</span><br>${esc(n.summary)}</div>`).join("")}
        ${open.length ? `<div style="margin-top:10px;font-size:13px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.05em">Open items</div>${open.map((c) => `<div style="font-size:14px;color:#111827;padding:3px 0">• ${esc(commitmentLine(c))}</div>`).join("")}` : ""}
        ${said.map((q) => `<div style="margin-top:8px;font-size:14px;color:#374151;font-style:italic;border-left:3px solid #a855f7;padding-left:10px">“${esc(q.text)}”</div>`).join("")}
        <div style="margin-top:10px"><a href="${esc(`${app}/briefing/${p.id}`)}" style="font-size:13px;color:#2563eb">Open full prep →</a></div>
      </div>`,
    });
  }

  const when = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", minute: "2-digit" }).format(event.startsAt);
  const subject = `Prep: ${event.title || "Meeting"} at ${when}`;
  const text = `${event.title || "Meeting"} — ${when}\n\n${sections.map((s) => s.text).join("\n\n")}\n\n${app}`;
  const html = `<!doctype html><html><body style="margin:0;background:#f2f2f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;padding:24px 12px">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:20px;padding:28px">
    <div style="font-size:13px;font-weight:700;color:#ef4444">● Recap · meeting prep</div>
    <div style="font-size:22px;font-weight:700;color:#111827;margin-top:8px">${esc(event.title || "Meeting")}</div>
    <div style="font-size:14px;color:#6b7280;margin:4px 0 12px">${esc(when)}${event.location ? ` · ${esc(event.location)}` : ""}</div>
    ${sections.map((s) => s.html).join("")}
    <div style="font-size:12px;color:#9ca3af;margin-top:20px">Sent because meeting prep emails are on. <a href="${esc(`${app}/settings`)}" style="color:#6b7280">Change settings</a>.</div>
  </div></body></html>`;
  return { subject, text, html };
}

/** Email a brief ~30 minutes before meetings with people you've recorded conversations with. */
export async function sendPrepBriefs(now = new Date()) {
  if (!isEmailConfigured()) return;
  const due = await db
    .select({ event: calendarEvents, user: users })
    .from(calendarEvents)
    .innerJoin(users, eq(calendarEvents.userId, users.id))
    .where(and(
      isNull(calendarEvents.prepSentAt),
      eq(users.prepBriefsEnabled, true),
      isNotNull(users.calendarIcsUrl),
      gte(calendarEvents.startsAt, new Date(now.getTime() + 10 * 60000)),
      lte(calendarEvents.startsAt, new Date(now.getTime() + 45 * 60000)),
    ));
  for (const { event, user } of due) {
    const to = user.digestEmail || user.email;
    try {
      const brief = to ? await buildPrepBrief(user.id, event) : null;
      if (brief && to) {
        await sendEmail({ to, ...brief });
        console.log(`[calendar] prep brief sent for event ${event.id}`);
      }
      await db.update(calendarEvents).set({ prepSentAt: now }).where(eq(calendarEvents.id, event.id));
    } catch (err) {
      console.error(`[calendar] prep brief failed for ${event.id}:`, err);
    }
  }
}

