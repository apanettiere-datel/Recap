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
