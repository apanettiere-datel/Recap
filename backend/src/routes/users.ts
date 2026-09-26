import { Hono } from "hono";
import { db } from "../services/db.js";
import { users } from "../models/schema.js";
import { eq } from "drizzle-orm";

import { AppEnv } from "../types.js";
import { buildDigest, isValidTimezone } from "../services/digest.js";
import { sendEmail, isEmailConfigured, isValidEmail, EmailNotConfiguredError } from "../services/email.js";
import { RETENTION_CHOICES, deleteAuthAccount, deleteUserData, purgeExpiredAudio } from "../services/privacy.js";
import { buildDataArchive } from "../services/export.js";
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

// Custom vocabulary: names, companies and jargon the transcriber should spell correctly
app.get("/me/vocabulary", async (c) => {
  const user = await currentUser(c.get("userId"));
  if (!user) return c.json({ error: "User not found" }, 404);
  return c.json({ terms: user.vocabulary ?? [] });
});

app.put("/me/vocabulary", async (c) => {
  const body = await c.req.json<{ terms?: unknown }>().catch(() => null);
  if (!body || !Array.isArray(body.terms)) return c.json({ error: "Send { terms: [...] }" }, 400);
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const t of body.terms) {
    if (typeof t !== "string") continue;
    const clean = t.trim().replace(/\s+/g, " ").slice(0, 60);
    if (!clean || seen.has(clean.toLowerCase())) continue;
    seen.add(clean.toLowerCase());
    terms.push(clean);
  }
  if (terms.length > 300) return c.json({ error: "Keep the list under 300 terms." }, 400);
  const [updated] = await db.update(users).set({ vocabulary: terms }).where(eq(users.id, c.get("userId"))).returning();
  return c.json({ terms: updated.vocabulary });
});

// Commitment reminder emails
app.get("/me/reminders", async (c) => {
  const user = await currentUser(c.get("userId"));
  if (!user) return c.json({ error: "User not found" }, 404);
  return c.json({ enabled: user.remindersEnabled, hour: user.reminderHour, timezone: user.timezone, email: user.digestEmail || user.email || "", emailConfigured: isEmailConfigured() });
});

app.patch("/me/reminders", async (c) => {
  const body = await c.req.json<{ enabled?: boolean; hour?: number; timezone?: string }>().catch(() => null);
  if (!body) return c.json({ error: "Invalid request body" }, 400);
  const user = await currentUser(c.get("userId"));
  if (!user) return c.json({ error: "User not found" }, 404);
  const updates: Partial<typeof users.$inferInsert> = {};
  if (body.hour !== undefined) {
    if (!Number.isInteger(body.hour) || body.hour < 0 || body.hour > 23) return c.json({ error: "Invalid hour" }, 400);
    updates.reminderHour = body.hour;
  }
  if (body.timezone !== undefined) {
    if (!isValidTimezone(body.timezone)) return c.json({ error: "Invalid timezone" }, 400);
    updates.timezone = body.timezone;
  }
  if (body.enabled !== undefined) {
    if (body.enabled && !(user.digestEmail || user.email)) return c.json({ error: "Add an email address under Weekly email summary first." }, 400);
    updates.remindersEnabled = !!body.enabled;
  }
  const [updated] = Object.keys(updates).length ? await db.update(users).set(updates).where(eq(users.id, user.id)).returning() : [user];
  return c.json({ enabled: updated.remindersEnabled, hour: updated.reminderHour, timezone: updated.timezone, email: updated.digestEmail || updated.email || "", emailConfigured: isEmailConfigured() });
});

// Privacy: how long to keep recordings' audio
app.get("/me/privacy", async (c) => {
  const user = await currentUser(c.get("userId"));
  if (!user) return c.json({ error: "User not found" }, 404);
  return c.json({ audioRetentionDays: user.audioRetentionDays, choices: RETENTION_CHOICES });
});

app.patch("/me/privacy", async (c) => {
  const body = await c.req.json<{ audioRetentionDays?: number | null }>().catch(() => null);
  if (!body || !("audioRetentionDays" in body)) return c.json({ error: "Invalid request body" }, 400);
  const days = body.audioRetentionDays;
  if (days !== null && !RETENTION_CHOICES.includes(days as never)) return c.json({ error: "Choose one of the offered periods." }, 400);
  const [updated] = await db.update(users).set({ audioRetentionDays: days }).where(eq(users.id, c.get("userId"))).returning();
  // Apply straight away rather than waiting for the hourly job
  if (days) purgeExpiredAudio().catch((e) => console.error("[privacy] purge failed:", e));
  return c.json({ audioRetentionDays: updated.audioRetentionDays, choices: RETENTION_CHOICES });
});

// Download everything as a ZIP (data.json + a Markdown file per conversation)
app.get("/me/export", async (c) => {
  const zip = await buildDataArchive(c.get("userId"));
  const day = new Date().toISOString().slice(0, 10);
  return new Response(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="recap-export-${day}.zip"`,
      "Content-Length": String(zip.byteLength),
      "Cache-Control": "no-store",
    },
  });
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

// Delete all data (recordings, audio files, people, everything).
// DELETE /api/users?account=1 also deletes the sign-in account itself.
app.delete("/", async (c) => {
  const firebaseUid = c.get("firebaseUid") as string;

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.firebaseUid, firebaseUid))
    .limit(1);

  if (!user) return c.json({ error: "User not found" }, 404);

  const deleteAccount = c.req.query("account") === "1";
  await deleteUserData(user.id, { keepAccount: !deleteAccount });

  let accountDeleted = false;
  if (deleteAccount) {
    try {
      accountDeleted = await deleteAuthAccount(firebaseUid);
    } catch (err) {
      console.error("[account] could not delete sign-in account:", err);
      return c.json({ ok: true, accountDeleted: false, error: "Your data was deleted, but the sign-in account couldn't be removed. Try again, or contact support." }, 502);
    }
  }
  console.log(`[account] deleted ${deleteAccount ? "account and " : ""}all data for user ${user.id}`);
  return c.json({ ok: true, accountDeleted });
});

export default app;
