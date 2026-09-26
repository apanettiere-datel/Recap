import { Context, Next } from "hono";
import { db } from "../services/db.js";
import { users } from "../models/schema.js";
import { eq } from "drizzle-orm";

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 100;
const RATE_WINDOW_MS = 60_000;

export async function rateLimiter(c: Context, next: Next) {
  const uid = c.get("firebaseUid") as string;
  const now = Date.now();

  const entry = rateLimitMap.get(uid);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(uid, { count: 1, resetAt: now + RATE_WINDOW_MS });
  } else {
    entry.count++;
    if (entry.count > RATE_LIMIT) {
      return c.json({ error: "Rate limit exceeded" }, 429);
    }
  }

  await next();
}

export async function resolveUser(c: Context, next: Next) {
  const firebaseUid = c.get("firebaseUid") as string;
  const email = c.get("email") as string | undefined;

  let [user] = await db
    .select()
    .from(users)
    .where(eq(users.firebaseUid, firebaseUid))
    .limit(1);

  if (!user) {
    [user] = await db
      .insert(users)
      .values({ firebaseUid, email })
      .onConflictDoNothing()
      .returning();
    if (!user) {
      [user] = await db
        .select()
        .from(users)
        .where(eq(users.firebaseUid, firebaseUid))
        .limit(1);
    }
    console.log("[resolveUser] auto-created user:", firebaseUid);
  }

  c.set("userId", user.id);
  await next();
}

export function validateContentLength(maxBytes: number) {
  return async (c: Context, next: Next) => {
    const contentLength = c.req.header("content-length");
    if (contentLength && parseInt(contentLength) > maxBytes) {
      return c.json({ error: `This recording is too large to upload (max ${Math.round(maxBytes / 1024 / 1024)}MB).` }, 413);
    }
    await next();
  };
}

export async function errorHandler(c: Context, next: Next) {
  try {
    await next();
  } catch (error) {
    console.error("Unhandled error:", error);
    return c.json({ error: "Something went wrong on our end. Please try again." }, 500);
  }
}
