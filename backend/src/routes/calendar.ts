import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../services/db.js";
import { calendarEvents, users } from "../models/schema.js";
import { AppEnv } from "../types.js";
import { CalendarError, normalizeIcsUrl, syncCalendar, upcomingMeetings, buildPrepBrief } from "../services/calendar.js";
import { isEmailConfigured } from "../services/email.js";

const app = new Hono<AppEnv>();

/** Show only the provider host; the full link is a secret. */
function maskUrl(url: string | null) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return `${u.host}/…${u.pathname.slice(-6)}`;
  } catch {
    return "connected";
  }
}

async function connection(userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  return {
    connected: !!user?.calendarIcsUrl,
    source: maskUrl(user?.calendarIcsUrl ?? null),
    lastSyncAt: user?.calendarLastSyncAt ?? null,
    error: user?.calendarError ?? null,
    prepBriefsEnabled: user?.prepBriefsEnabled ?? true,
    emailConfigured: isEmailConfigured(),
  };
}

app.get("/connection", async (c) => c.json(await connection(c.get("userId"))));

// Connect: PUT /api/calendar/connection { url }
app.put("/connection", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{ url?: string }>().catch(() => null);
  if (!body?.url) return c.json({ error: "Paste your calendar's private iCal (.ics) link." }, 400);
  let url: string;
  try {
    url = normalizeIcsUrl(body.url);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
  const [previous] = await db.select({ url: users.calendarIcsUrl }).from(users).where(eq(users.id, userId));
  await db.update(users).set({ calendarIcsUrl: url, calendarError: null }).where(eq(users.id, userId));
  try {
    const result = await syncCalendar(userId);
    return c.json({ ...(await connection(userId)), events: result.events });
  } catch (err) {
    // Keep the old working link if the new one can't be read
    await db.update(users).set({ calendarIcsUrl: previous?.url ?? null, calendarError: null }).where(eq(users.id, userId));
    return c.json({ error: err instanceof CalendarError ? err.message : "Couldn't read that calendar." }, 400);
  }
});

app.delete("/connection", async (c) => {
  const userId = c.get("userId");
  await db.update(users).set({ calendarIcsUrl: null, calendarError: null, calendarLastSyncAt: null }).where(eq(users.id, userId));
  await db.delete(calendarEvents).where(eq(calendarEvents.userId, userId));
  return c.json(await connection(userId));
});

app.post("/sync", async (c) => {
  const userId = c.get("userId");
  try {
    const result = await syncCalendar(userId);
    return c.json({ ...(await connection(userId)), events: result.events });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 502);
  }
});

app.patch("/settings", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{ prepBriefsEnabled?: boolean }>().catch(() => null);
  if (typeof body?.prepBriefsEnabled === "boolean") {
    await db.update(users).set({ prepBriefsEnabled: body.prepBriefsEnabled }).where(eq(users.id, userId));
  }
  return c.json(await connection(userId));
});

// Upcoming meetings (next 7 days) with the people you've recorded before
app.get("/upcoming", async (c) => {
  const days = Math.min(14, Math.max(1, parseInt(c.req.query("days") ?? "7", 10) || 7));
  return c.json(await upcomingMeetings(c.get("userId"), days));
});

// Preview the prep brief email for one meeting
app.get("/events/:id/brief", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return c.json({ error: "Not found" }, 404);
  const [event] = await db.select().from(calendarEvents).where(eq(calendarEvents.id, id));
  if (!event || event.userId !== userId) return c.json({ error: "Not found" }, 404);
  const brief = await buildPrepBrief(userId, event);
  if (!brief) return c.json({ error: "You haven't recorded conversations with anyone in this meeting yet." }, 404);
  return c.json(brief);
});

export default app;
