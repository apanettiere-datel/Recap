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
import recordingsRoutes, { recoverAbandonedSessions } from "./routes/recordings.js";
import calendarRoutes from "./routes/calendar.js";
import projectRoutes from "./routes/projects.js";
import integrationRoutes from "./routes/integrations.js";
import { shareAdmin, sharePublic } from "./routes/shares.js";
import { backfillEmbeddings } from "./services/semantic.js";
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
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  allowHeaders: ["Authorization", "Content-Type"],
  // So the web app can read the file name of exports and downloads
  exposeHeaders: ["Content-Disposition"],
}));

// Request logging
app.use("*", async (c, next) => {
  const start = Date.now();
  await next();
  console.log(`[${c.req.method}] ${c.req.path} → ${c.res.status} (${Date.now() - start}ms)`);
});

// Health check (no auth)
app.get("/health", (c) => c.json({ status: "ok", version: "1.0.0" }));

// Public share links (no auth; tokens are unguessable and revocable)
app.route("/public", sharePublic);

// Auth required for all API routes
app.use("/api/*", authMiddleware);
app.use("/api/*", rateLimiter);

// User sync (before resolveUser since it creates the user)
app.use("/api/users/me/*", resolveUser);
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
app.use("/api/recordings/*", resolveUser);
app.use("/api/calendar/*", resolveUser);
app.use("/api/projects", resolveUser);
app.use("/api/projects/*", resolveUser);
app.use("/api/integrations", resolveUser);
app.use("/api/integrations/*", resolveUser);
app.use("/api/recordings/*", bodyLimit({
  maxSize: 40 * 1024 * 1024,
  onError: (c) => c.json({ error: "Recording part too large" }, 413),
}));

// Audio upload limit: 250MB (supports recordings up to ~2 hours)
app.use("/api/notes", validateContentLength(250 * 1024 * 1024));
app.use("/api/notes", bodyLimit({
  maxSize: 250 * 1024 * 1024,
  onError: (c) => c.json({ error: "This recording is too large to upload (max 250MB)." }, 413),
}));

// Routes
app.route("/api/notes", shareAdmin);
app.route("/api/notes", notesRoutes);
app.route("/api/calendar", calendarRoutes);
app.route("/api/projects", projectRoutes);
app.route("/api/integrations", integrationRoutes);
app.route("/api/people", peopleRoutes);
app.route("/api/commitments", commitmentsRoutes);
app.route("/api/insights", insightsRoutes);
app.route("/api/briefing", briefingRoutes);
app.route("/api/recordings", recordingsRoutes);

const port = parseInt(process.env.PORT ?? "3000");

/**
 * Columns the processing pipeline depends on. Applied idempotently at boot so the API
 * works even before the deploy script runs the SQL migrations.
 */
const MIGRATION_0007 = `
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "vocabulary" text[] DEFAULT '{}' NOT NULL;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "reminders_enabled" boolean DEFAULT false NOT NULL;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "reminder_hour" integer DEFAULT 8 NOT NULL;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_reminder_date" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "calendar_ics_url" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "calendar_last_sync_at" timestamp;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "calendar_error" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "prep_briefs_enabled" boolean DEFAULT true NOT NULL;
ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "speakers" jsonb;
ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "calendar_event_id" uuid;
ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "meeting_title" text;
ALTER TABLE "commitments" ADD COLUMN IF NOT EXISTS "due_reminded_at" timestamp;
ALTER TABLE "commitments" ADD COLUMN IF NOT EXISTS "overdue_reminded_at" timestamp;
CREATE TABLE IF NOT EXISTS "note_chunks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "note_id" uuid NOT NULL REFERENCES "notes"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "start" real,
  "text" text NOT NULL,
  "embedding" real[],
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "note_chunks_user_idx" ON "note_chunks" ("user_id");
CREATE INDEX IF NOT EXISTS "note_chunks_note_idx" ON "note_chunks" ("note_id");
CREATE TABLE IF NOT EXISTS "calendar_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "uid" text NOT NULL,
  "starts_at" timestamp NOT NULL,
  "ends_at" timestamp NOT NULL,
  "title" text DEFAULT '' NOT NULL,
  "location" text,
  "attendees" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "prep_sent_at" timestamp,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "calendar_events_occurrence_idx" ON "calendar_events" ("user_id", "uid", "starts_at");
CREATE INDEX IF NOT EXISTS "calendar_events_user_start_idx" ON "calendar_events" ("user_id", "starts_at");
CREATE TABLE IF NOT EXISTS "shares" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "note_id" uuid NOT NULL REFERENCES "notes"("id") ON DELETE CASCADE,
  "token" text NOT NULL UNIQUE,
  "include_audio" boolean DEFAULT false NOT NULL,
  "include_transcript" boolean DEFAULT false NOT NULL,
  "views" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "revoked_at" timestamp
);
`;

const MIGRATION_0008 = `
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "audio_retention_days" integer;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "todoist_token" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "notion_token" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "notion_parent_id" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "notion_parent_title" text;
ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "my_notes" jsonb;
ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "audio_deleted_at" timestamp;
ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "notion_page_url" text;
ALTER TABLE "commitments" ADD COLUMN IF NOT EXISTS "todoist_task_id" text;
CREATE TABLE IF NOT EXISTS "projects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "color" text DEFAULT 'blue' NOT NULL,
  "status" jsonb,
  "status_updated_at" timestamp,
  "status_stale" boolean DEFAULT true NOT NULL,
  "archived_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "projects_user_idx" ON "projects" ("user_id");
CREATE TABLE IF NOT EXISTS "note_projects" (
  "note_id" uuid NOT NULL REFERENCES "notes"("id") ON DELETE CASCADE,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "auto" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "note_projects_pair_idx" ON "note_projects" ("note_id", "project_id");
CREATE INDEX IF NOT EXISTS "note_projects_project_idx" ON "note_projects" ("project_id");
`;

async function ensureSchema() {
  await db.execute(sql.raw(`
    ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "processing_stage" text;
    ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "processing_started_at" timestamp;
    ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "segments" jsonb;
    ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "digest_enabled" boolean DEFAULT false NOT NULL;
    ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "digest_email" text;
    ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "digest_day" integer DEFAULT 1 NOT NULL;
    ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "digest_hour" integer DEFAULT 8 NOT NULL;
    ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "timezone" text DEFAULT 'UTC' NOT NULL;
    ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_digest_sent_at" timestamp;
  `));
  await db.execute(sql.raw(MIGRATION_0007));
  await db.execute(sql.raw(MIGRATION_0008));
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
  // Recordings whose device disappeared mid-recording
  const recover = () => recoverAbandonedSessions().catch((e) => console.error("[recordings] recovery failed:", e));
  recover();
  setInterval(recover, 5 * 60 * 1000).unref();
  // Search by meaning for conversations recorded before it existed (or that failed to index)
  const backfill = () => backfillEmbeddings().catch((e) => console.error("[semantic] backfill failed:", e));
  setTimeout(backfill, 15_000).unref();
  setInterval(backfill, 30 * 60 * 1000).unref();
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
