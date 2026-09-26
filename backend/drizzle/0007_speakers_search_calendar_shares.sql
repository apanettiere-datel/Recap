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
