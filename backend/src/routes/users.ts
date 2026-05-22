import { Hono } from "hono";
import { db } from "../services/db.js";
import { users, notes, commitments, people, insights, weeklyReports } from "../models/schema.js";
import { eq } from "drizzle-orm";

import { AppEnv } from "../types.js";
const app = new Hono<AppEnv>();

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
