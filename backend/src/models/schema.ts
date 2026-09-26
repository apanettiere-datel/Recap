import { pgTable, uuid, text, timestamp, boolean, real, integer, pgEnum, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const commitmentOwnerEnum = pgEnum("commitment_owner", ["me", "them"]);
export const commitmentStatusEnum = pgEnum("commitment_status", ["open", "completed", "overdue"]);
export const insightTypeEnum = pgEnum("insight_type", [
  "overdue_commitment",
  "dropped_thread",
  "recurring_topic",
  "relationship_decay",
  "sentiment_shift",
  "avoidance_pattern",
  "accountability",
  "activity_summary",
]);
export const insightPriorityEnum = pgEnum("insight_priority", ["low", "medium", "high", "urgent"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  firebaseUid: text("firebase_uid").notNull().unique(),
  email: text("email"),
  displayName: text("display_name"),
  digestEnabled: boolean("digest_enabled").default(false).notNull(),
  digestEmail: text("digest_email"),
  digestDay: integer("digest_day").default(1).notNull(), // 0 = Sunday
  digestHour: integer("digest_hour").default(8).notNull(),
  timezone: text("timezone").default("UTC").notNull(),
  lastDigestSentAt: timestamp("last_digest_sent_at"),
  // Names, companies and jargon the transcriber should spell correctly
  vocabulary: text("vocabulary").array().default([]).notNull(),
  remindersEnabled: boolean("reminders_enabled").default(false).notNull(),
  reminderHour: integer("reminder_hour").default(8).notNull(),
  lastReminderDate: text("last_reminder_date"),
  calendarIcsUrl: text("calendar_ics_url"),
  calendarLastSyncAt: timestamp("calendar_last_sync_at"),
  calendarError: text("calendar_error"),
  prepBriefsEnabled: boolean("prep_briefs_enabled").default(true).notNull(),
  // Delete recordings' audio (keeping transcripts and summaries) after this many days; null = keep
  audioRetentionDays: integer("audio_retention_days"),
  todoistToken: text("todoist_token"),
  notionToken: text("notion_token"),
  notionParentId: text("notion_parent_id"),
  notionParentTitle: text("notion_parent_title"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** A timed piece of transcript: start/end seconds and text. */
export type TranscriptSegment = { s: number; e: number; t: string; k?: string };

/** Something the recorder typed or bookmarked while recording; t = seconds into the recording. */
export type MyNote = { id: string; t: number | null; text: string; mark?: boolean };

export const notes = pgTable("notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").default("").notNull(),
  transcript: text("transcript").default("").notNull(),
  segments: jsonb("segments").$type<TranscriptSegment[]>(),
  // Speaker label (segment.k) → display name, e.g. { "A": "Me", "B": "Sarah" }
  speakers: jsonb("speakers").$type<Record<string, string>>(),
  calendarEventId: uuid("calendar_event_id"),
  meetingTitle: text("meeting_title"),
  myNotes: jsonb("my_notes").$type<MyNote[]>(),
  audioDeletedAt: timestamp("audio_deleted_at"),
  notionPageUrl: text("notion_page_url"),
  summary: text("summary").default("").notNull(),
  sentiment: text("sentiment").default("").notNull(),
  audioUrl: text("audio_url").notNull(),
  duration: real("duration").default(0).notNull(),
  conversationMode: text("conversation_mode").default("general").notNull(),
  isProcessing: boolean("is_processing").default(true).notNull(),
  processingError: text("processing_error"),
  processingStage: text("processing_stage"),
  processingStartedAt: timestamp("processing_started_at"),
  isPinned: boolean("is_pinned").default(false).notNull(),
  isArchived: boolean("is_archived").default(false).notNull(),
  recordedAt: timestamp("recorded_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const people = pgTable("people", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  relationship: text("relationship").default("").notNull(),
  keywords: text("keywords").array().default([]).notNull(),
  phone: text("phone"),
  email: text("email"),
  role: text("role"),
  organization: text("organization"),
  notes: text("notes").default("").notNull(),
  lastContactDate: timestamp("last_contact_date"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const commitments = pgTable("commitments", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  noteId: uuid("note_id").references(() => notes.id, { onDelete: "cascade" }),
  personId: uuid("person_id").references(() => people.id, { onDelete: "set null" }),
  description: text("description").notNull(),
  owner: commitmentOwnerEnum("owner").notNull(),
  status: commitmentStatusEnum("status").default("open").notNull(),
  dueDate: timestamp("due_date"),
  completedAt: timestamp("completed_at"),
  priority: text("priority").default("medium"),
  addedToCalendar: boolean("added_to_calendar").default(false).notNull(),
  dueRemindedAt: timestamp("due_reminded_at"),
  overdueRemindedAt: timestamp("overdue_reminded_at"),
  todoistTaskId: text("todoist_task_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const topics = pgTable("topics", {
  id: uuid("id").primaryKey().defaultRandom(),
  noteId: uuid("note_id").notNull().references(() => notes.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const notePeople = pgTable("note_people", {
  noteId: uuid("note_id").notNull().references(() => notes.id, { onDelete: "cascade" }),
  personId: uuid("person_id").notNull().references(() => people.id, { onDelete: "cascade" }),
});

export const quotes = pgTable("quotes", {
  id: uuid("id").primaryKey().defaultRandom(),
  noteId: uuid("note_id").notNull().references(() => notes.id, { onDelete: "cascade" }),
  personId: uuid("person_id").references(() => people.id, { onDelete: "set null" }),
  text: text("text").notNull(),
  speaker: text("speaker").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const tags = pgTable("tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  noteId: uuid("note_id").notNull().references(() => notes.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insights = pgTable("insights", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: insightTypeEnum("type").notNull(),
  priority: insightPriorityEnum("priority").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  relatedPersonName: text("related_person_name"),
  isRead: boolean("is_read").default(false).notNull(),
  isDismissed: boolean("is_dismissed").default(false).notNull(),
  generatedAt: timestamp("generated_at").defaultNow().notNull(),
});

export const weeklyReports = pgTable("weekly_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  weekStarting: timestamp("week_starting").notNull(),
  narrative: text("narrative").default("").notNull(),
  commitmentsMade: integer("commitments_made").default(0).notNull(),
  commitmentsCompleted: integer("commitments_completed").default(0).notNull(),
  commitmentsOverdue: integer("commitments_overdue").default(0).notNull(),
  conversationCount: integer("conversation_count").default(0).notNull(),
  uniquePeopleCount: integer("unique_people_count").default(0).notNull(),
  topTopics: text("top_topics").array().default([]).notNull(),
  droppedThreads: text("dropped_threads").array().default([]).notNull(),
  avoidedTopics: text("avoided_topics").array().default([]).notNull(),
  suggestedFocus: text("suggested_focus").array().default([]).notNull(),
  generatedAt: timestamp("generated_at").defaultNow().notNull(),
});

/** Transcript passages with embeddings, for search by meaning. */
export const noteChunks = pgTable("note_chunks", {
  id: uuid("id").primaryKey().defaultRandom(),
  noteId: uuid("note_id").notNull().references(() => notes.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  start: real("start"),
  text: text("text").notNull(),
  embedding: real("embedding").array(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  userIdx: index("note_chunks_user_idx").on(t.userId),
  noteIdx: index("note_chunks_note_idx").on(t.noteId),
}));

export type Attendee = { name: string; email: string | null };

export const calendarEvents = pgTable("calendar_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  uid: text("uid").notNull(),
  startsAt: timestamp("starts_at").notNull(),
  endsAt: timestamp("ends_at").notNull(),
  title: text("title").default("").notNull(),
  location: text("location"),
  attendees: jsonb("attendees").$type<Attendee[]>().default([]).notNull(),
  prepSentAt: timestamp("prep_sent_at"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  occurrence: uniqueIndex("calendar_events_occurrence_idx").on(t.userId, t.uid, t.startsAt),
  userStart: index("calendar_events_user_start_idx").on(t.userId, t.startsAt),
}));

/** Public read-only links to a conversation. */
export const shares = pgTable("shares", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  noteId: uuid("note_id").notNull().references(() => notes.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  includeAudio: boolean("include_audio").default(false).notNull(),
  includeTranscript: boolean("include_transcript").default(false).notNull(),
  views: integer("views").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  revokedAt: timestamp("revoked_at"),
});

export type ProjectStatus = {
  overview: string;
  decisions: string[];
  openQuestions: string[];
  risks: string[];
  nextSteps: string[];
  latest: { noteId: string; title: string; changes: string } | null;
};

/** A group of conversations about one piece of work (a deal, a client, a rollout). */
export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").default("").notNull(),
  color: text("color").default("blue").notNull(),
  status: jsonb("status").$type<ProjectStatus>(),
  statusUpdatedAt: timestamp("status_updated_at"),
  statusStale: boolean("status_stale").default(true).notNull(),
  archivedAt: timestamp("archived_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  userIdx: index("projects_user_idx").on(t.userId),
}));

export const noteProjects = pgTable("note_projects", {
  noteId: uuid("note_id").notNull().references(() => notes.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  // Added by the AI rather than by the user
  auto: boolean("auto").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  pair: uniqueIndex("note_projects_pair_idx").on(t.noteId, t.projectId),
  projectIdx: index("note_projects_project_idx").on(t.projectId),
}));

// Relations
export const notesRelations = relations(notes, ({ one, many }) => ({
  user: one(users, { fields: [notes.userId], references: [users.id] }),
  commitments: many(commitments),
  topics: many(topics),
  quotes: many(quotes),
  notePeople: many(notePeople),
  tags: many(tags),
}));

export const peopleRelations = relations(people, ({ one, many }) => ({
  user: one(users, { fields: [people.userId], references: [users.id] }),
  commitments: many(commitments),
  notePeople: many(notePeople),
  quotes: many(quotes),
}));

export const commitmentsRelations = relations(commitments, ({ one }) => ({
  note: one(notes, { fields: [commitments.noteId], references: [notes.id] }),
  person: one(people, { fields: [commitments.personId], references: [people.id] }),
  user: one(users, { fields: [commitments.userId], references: [users.id] }),
}));

export const tagsRelations = relations(tags, ({ one }) => ({
  note: one(notes, { fields: [tags.noteId], references: [notes.id] }),
  user: one(users, { fields: [tags.userId], references: [users.id] }),
}));
