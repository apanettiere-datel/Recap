ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "processing_stage" text;
ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "processing_started_at" timestamp;
CREATE INDEX IF NOT EXISTS "notes_user_recorded_idx" ON "notes" ("user_id", "recorded_at" DESC);
CREATE INDEX IF NOT EXISTS "notes_processing_idx" ON "notes" ("is_processing") WHERE "is_processing" = true;
CREATE INDEX IF NOT EXISTS "tags_note_idx" ON "tags" ("note_id");
CREATE INDEX IF NOT EXISTS "topics_note_idx" ON "topics" ("note_id");
CREATE INDEX IF NOT EXISTS "quotes_note_idx" ON "quotes" ("note_id");
CREATE INDEX IF NOT EXISTS "commitments_note_idx" ON "commitments" ("note_id");
CREATE INDEX IF NOT EXISTS "note_people_note_idx" ON "note_people" ("note_id");
