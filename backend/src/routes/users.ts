import { Hono } from "hono";
import { db } from "../services/db.js";
import { users, notes, commitments, people, insights, weeklyReports } from "../models/schema.js";
import { eq } from "drizzle-orm";

import { AppEnv } from "../types.js";
import { buildDigest, isValidTimezone } from "../services/digest.js";
import { sendEmail, isEmailConfigured, isValidEmail, EmailNotConfiguredError } from "../services/email.js";
const app = new Hono<AppEnv>();

function digestSettings(user: typeof users.$inferSelect) {
  return {
    enabled: user.digestEnabled,
    email: user.digestEmail || user.email || "",
    day: user.digestDay,
    hour: user.digestHour,
    timezone: user.timezone,
    lastSentAt: user.lastDigestSentAt,
    emailConfigured: isEmailConfigured(),
  };
}

async function currentUser(userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  return user;
}

// Weekly email summary settings
app.get("/me/digest", async (c) => {
  const user = await currentUser(c.get("userId"));
  if (!user) return c.json({ error: "User not found" }, 404);
  return c.json(digestSettings(user));
});

app.patch("/me/digest", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{ enabled?: boolean; email?: string; day?: number; hour?: number; timezone?: string }>().catch(() => null);
  if (!body) return c.json({ error: "Invalid request body" }, 400);

  const updates: Partial<typeof users.$inferInsert> = {};
  if (body.email !== undefined) {
    const email = String(body.email).trim();
    if (email && !isValidEmail(email)) return c.json({ error: "That email address doesn't look right." }, 400);
    updates.digestEmail = email || null;
  }
  if (body.day !== undefined) {
    if (!Number.isInteger(body.day) || body.day < 0 || body.day > 6) return c.json({ error: "Invalid day" }, 400);
    updates.digestDay = body.day;
  }
  if (body.hour !== undefined) {
    if (!Number.isInteger(body.hour) || body.hour < 0 || body.hour > 23) return c.json({ error: "Invalid hour" }, 400);
    updates.digestHour = body.hour;
  }
  if (body.timezone !== undefined) {
    if (!isValidTimezone(body.timezone)) return c.json({ error: "Invalid timezone" }, 400);
    updates.timezone = body.timezone;
  }
  if (body.enabled !== undefined) updates.digestEnabled = !!body.enabled;

  const user = await currentUser(userId);
  if (!user) return c.json({ error: "User not found" }, 404);
  const target = updates.digestEmail !== undefined ? updates.digestEmail : user.digestEmail || user.email;
  if ((updates.digestEnabled ?? user.digestEnabled) && !target) {
    return c.json({ error: "Add an email address to receive the weekly summary." }, 400);
  }

  const [updated] = Object.keys(updates).length
    ? await db.update(users).set(updates).where(eq(users.id, userId)).returning()
    : [user];
  return c.json(digestSettings(updated));
});

app.get("/me/digest/preview", async (c) => {
  const digest = await buildDigest(c.get("userId"));
  return c.json(digest);
});

app.post("/me/digest/send", async (c) => {
  const user = await currentUser(c.get("userId"));
  if (!user) return c.json({ error: "User not found" }, 404);
  const to = user.digestEmail || user.email;
  if (!to) return c.json({ error: "Add an email address first." }, 400);
  try {
    const digest = await buildDigest(user.id);
    await sendEmail({ to, subject: digest.subject, html: digest.html, text: digest.text });
    return c.json({ ok: true, to });
  } catch (err) {
    if (err instanceof EmailNotConfiguredError) return c.json({ error: err.message }, 503);
    console.error("[digest] test send failed:", err);
    return c.json({ error: `Couldn't send the email: ${(err as Error).message}` }, 502);
  }
});

// Get or create user (called on first app launch after auth)
app.post("/sync", async (c) => {
  const firebaseUid = c.get("firebaseUid") as string;
  const email = c.get("email") as string | undefined;

  const existing = await db
    .select()
    .from(users)
    .where(eq(users.firebaseUid, firebaseUid))
    .limit(1);

  if (existing.length > 0) {
    c.set("userId", existing[0].id);
    return c.json(existing[0]);
  }

  const [created] = await db
    .insert(users)
    .values({ firebaseUid, email })
    .returning();

  c.set("userId", created.id);
  return c.json(created);
});

// Delete account and all data
app.delete("/", async (c) => {
  const firebaseUid = c.get("firebaseUid") as string;

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.firebaseUid, firebaseUid))
    .limit(1);

  if (!user) return c.json({ error: "User not found" }, 404);

  const userId = user.id;
  await db.delete(weeklyReports).where(eq(weeklyReports.userId, userId));
  await db.delete(insights).where(eq(insights.userId, userId));
  await db.delete(commitments).where(eq(commitments.userId, userId));
  await db.delete(people).where(eq(people.userId, userId));
  await db.delete(notes).where(eq(notes.userId, userId));
  await db.delete(users).where(eq(users.id, userId));

  return c.json({ ok: true });
});

export default app;
