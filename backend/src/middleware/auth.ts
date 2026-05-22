import { Context, Next } from "hono";
import admin from "firebase-admin";

const DEV_MODE = process.env.NODE_ENV !== "production";

if (!DEV_MODE && !admin.apps.length) {
  admin.initializeApp({
    projectId: process.env.FIREBASE_PROJECT_ID,
  });
}

export async function authMiddleware(c: Context, next: Next) {
  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) {
    return c.json({ error: "Missing authorization token" }, 401);
  }

  const token = header.slice(7);

  // Dev mode: skip Firebase, use a fixed test identity
  if (DEV_MODE && token === "dev-token") {
    c.set("firebaseUid", "dev-user-001");
    c.set("email", "dev@recap.test");
    await next();
    return;
  }

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    c.set("firebaseUid", decoded.uid);
    c.set("email", decoded.email);
    await next();
  } catch {
    return c.json({ error: "Invalid token" }, 401);
  }
}
