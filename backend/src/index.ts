import "dotenv/config";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { serve } from "@hono/node-server";
import { authMiddleware } from "./middleware/auth.js";
import { rateLimiter, resolveUser, validateContentLength, errorHandler } from "./middleware/security.js";
import notesRoutes from "./routes/notes.js";
import peopleRoutes from "./routes/people.js";
import commitmentsRoutes from "./routes/commitments.js";
import insightsRoutes from "./routes/insights.js";
import usersRoutes from "./routes/users.js";
import briefingRoutes from "./routes/briefing.js";
import { startWeeklyJobs } from "./jobs/weekly.js";
import { db } from "./services/db.js";
import { sql } from "drizzle-orm";
import { recoverInterruptedProcessing, failOrphanedProcessing } from "./services/processing.js";

const app = new Hono();

// Global middleware
app.use("*", errorHandler);
app.onError((err, c) => {
  console.error(`[error] ${c.req.method} ${c.req.path}:`, err);
  const status = (err as { status?: number }).status;
  if (status && status >= 400 && status < 500) {
    return c.json({ error: err.message || "Bad request" }, status as 400);
  }
  return c.json({ error: "Something went wrong on our end. Please try again." }, 500);
});
app.notFound((c) => c.json({ error: "Not found" }, 404));
app.use("*", cors({
  origin: "*",
  allowMethods: ["GET", "POST", "PATCH", "DELETE"],
  allowHeaders: ["Authorization", "Content-Type"],
}));

// Request logging
app.use("*", async (c, next) => {
  const start = Date.now();
  await next();
  console.log(`[${c.req.method}] ${c.req.path} → ${c.res.status} (${Date.now() - start}ms)`);
});

// Health check (no auth)
app.get("/health", (c) => c.json({ status: "ok", version: "1.0.0" }));

// Auth required for all API routes
app.use("/api/*", authMiddleware);
app.use("/api/*", rateLimiter);

// User sync (before resolveUser since it creates the user)
app.route("/api/users", usersRoutes);

// All other routes need a resolved user
app.use("/api/notes", resolveUser);
app.use("/api/notes/*", resolveUser);
app.use("/api/people", resolveUser);
app.use("/api/people/*", resolveUser);
app.use("/api/commitments", resolveUser);
app.use("/api/commitments/*", resolveUser);
app.use("/api/insights", resolveUser);
app.use("/api/insights/*", resolveUser);
app.use("/api/briefing/*", resolveUser);

// Audio upload limit: 250MB (supports recordings up to ~2 hours)
app.use("/api/notes", validateContentLength(250 * 1024 * 1024));
app.use("/api/notes", bodyLimit({
  maxSize: 250 * 1024 * 1024,
  onError: (c) => c.json({ error: "This recording is too large to upload (max 250MB)." }, 413),
}));

// Routes
app.route("/api/notes", notesRoutes);
app.route("/api/people", peopleRoutes);
app.route("/api/commitments", commitmentsRoutes);
app.route("/api/insights", insightsRoutes);
app.route("/api/briefing", briefingRoutes);

const port = parseInt(process.env.PORT ?? "3000");

/**
 * Columns the processing pipeline depends on. Applied idempotently at boot so the API
 * works even before the deploy script runs the SQL migrations.
 */
async function ensureSchema() {
  await db.execute(sql.raw(`
    ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "processing_stage" text;
    ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "processing_started_at" timestamp;
  `));
}

async function startBackgroundWork() {
  try {
    await ensureSchema();
  } catch (e) {
    console.error("[startup] schema check failed:", e);
  }
  try {
    await recoverInterruptedProcessing();
  } catch (e) {
    console.error("[startup] processing recovery failed:", e);
  }
  setInterval(() => {
    failOrphanedProcessing().catch((e) => console.error("[watchdog] failed:", e));
  }, 10 * 60 * 1000).unref();
}

serve({ fetch: app.fetch, port }, () => {
  console.log(`Recap API running on port ${port}`);
  startWeeklyJobs();
  startBackgroundWork();
});

// Don't let a stray rejection take the whole API (and every in-flight transcription) down
process.on("unhandledRejection", (reason) => {
  console.error("[process] unhandled rejection:", reason);
});
