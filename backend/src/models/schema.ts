import { pgTable, uuid, text, timestamp, boolean, real, integer, pgEnum } from "drizzle-orm/pg-core";
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
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const notes = pgTable("notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").default("").notNull(),
  transcript: text("transcript").default("").notNull(),
  summary: text("summary").default("").notNull(),
  sentiment: text("sentiment").default("").notNull(),
  audioUrl: text("audio_url").notNull(),
  duration: real("duration").default(0).notNull(),
  conversationMode: text("conversation_mode").default("general").notNull(),
  isProcessing: boolean("is_processing").default(true).notNull(),
  processingError: text("processing_error"),
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
