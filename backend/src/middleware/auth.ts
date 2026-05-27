import { Context, Next } from "hono";
import { verifyToken } from "@clerk/backend";

const DEV_MODE = process.env.NODE_ENV !== "production";
const CLERK_SECRET = process.env.CLERK_SECRET_KEY;

export async function authMiddleware(c: Context, next: Next) {
  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) {
    return c.json({ error: "Missing authorization token" }, 401);
  }

  const token = header.slice(7);

  // Dev mode: skip verification, use a fixed test identity
  if (DEV_MODE && token === "dev-token") {
    c.set("firebaseUid", "dev-user-001");
    c.set("email", "dev@recap.test");
    await next();
    return;
  }

  if (!CLERK_SECRET) {
    return c.json({ error: "Auth not configured" }, 500);
  }

  try {
    const payload = await verifyToken(token, { secretKey: CLERK_SECRET });
    console.log("[auth] verified sub:", payload.sub);
    c.set("firebaseUid", payload.sub);
    c.set("email", (payload as any).email || "");
    await next();
  } catch (e: any) {
    console.log("[auth] verify failed:", e.message || e);
    return c.json({ error: "Invalid token" }, 401);
  }
}
