ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "segments" jsonb;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "digest_enabled" boolean DEFAULT false NOT NULL;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "digest_email" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "digest_day" integer DEFAULT 1 NOT NULL;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "digest_hour" integer DEFAULT 8 NOT NULL;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "timezone" text DEFAULT 'UTC' NOT NULL;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_digest_sent_at" timestamp;
CREATE INDEX IF NOT EXISTS "note_people_person_idx" ON "note_people" ("person_id");
