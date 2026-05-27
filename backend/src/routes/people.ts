import { Hono } from "hono";
import { db } from "../services/db.js";
import { people, commitments, notes, notePeople, topics, quotes } from "../models/schema.js";
import { eq, and, desc, asc, sql, inArray } from "drizzle-orm";
import { AppEnv } from "../types.js";

const app = new Hono<AppEnv>();

// Export all people as CSV
app.get("/export", async (c) => {
  const userId = c.get("userId") as string;

  const userPeople = await db
    .select()
    .from(people)
    .where(eq(people.userId, userId))
    .orderBy(asc(people.name));

  const withStats = await Promise.all(
    userPeople.map(async (person) => {
      const noteCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(notePeople)
        .where(eq(notePeople.personId, person.id));

      const openCommitments = await db
        .select({ count: sql<number>`count(*)` })
        .from(commitments)
        .where(and(eq(commitments.personId, person.id), eq(commitments.status, "open")));

      return {
        ...person,
        totalConversations: Number(noteCount[0]?.count ?? 0),
        openCommitments: Number(openCommitments[0]?.count ?? 0),
      };
    })
  );

  const escapeCSV = (val: string | null | undefined) => {
    if (val == null) return "";
    const s = String(val);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const headers = ["Name", "Role", "Organization", "Email", "Phone", "Relationship", "Last Contact", "Conversations", "Open Commitments"];
  const rows = withStats.map((p) => [
    escapeCSV(p.name),
    escapeCSV(p.role),
    escapeCSV(p.organization),
    escapeCSV(p.email),
    escapeCSV(p.phone),
    escapeCSV(p.relationship),
    escapeCSV(p.lastContactDate ? new Date(p.lastContactDate).toISOString().split("T")[0] : null),
    String(p.totalConversations),
    String(p.openCommitments),
  ].join(","));

  const csv = [headers.join(","), ...rows].join("\n");

  c.header("Content-Type", "text/csv");
  c.header("Content-Disposition", "attachment; filename=recap-contacts.csv");
  return c.body(csv);
});

// Get all people
app.get("/", async (c) => {
  const userId = c.get("userId") as string;

  const sort = c.req.query("sort") ?? "name";

  let orderClause;
  if (sort === "lastContact") {
    orderClause = desc(people.lastContactDate);
  } else if (sort === "recent") {
    orderClause = desc(people.createdAt);
  } else {
    orderClause = asc(people.name);
  }

  const userPeople = await db
    .select()
    .from(people)
    .where(eq(people.userId, userId))
    .orderBy(orderClause);

  const withStats = await Promise.all(
    userPeople.map(async (person) => {
      const noteCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(notePeople)
        .where(eq(notePeople.personId, person.id));

      const openCommitments = await db
        .select({ count: sql<number>`count(*)` })
        .from(commitments)
        .where(and(eq(commitments.personId, person.id), eq(commitments.status, "open")));

      return {
        ...person,
        totalConversations: Number(noteCount[0]?.count ?? 0),
        openCommitments: Number(openCommitments[0]?.count ?? 0),
      };
    })
  );

  return c.json(withStats);
});

// Get person detail with insights
app.get("/:id", async (c) => {
  const userId = c.get("userId") as string;
  const personId = c.req.param("id");

  const [person] = await db
    .select()
    .from(people)
    .where(and(eq(people.id, personId), eq(people.userId, userId)));

  if (!person) return c.json({ error: "Not found" }, 404);

  const personNotes = await db
    .select({ note: notes })
    .from(notePeople)
    .innerJoin(notes, eq(notePeople.noteId, notes.id))
    .where(eq(notePeople.personId, personId))
    .orderBy(desc(notes.recordedAt));

  const personCommitments = await db
    .select()
    .from(commitments)
    .where(eq(commitments.personId, personId));

  // Compute insights
  const noteIds = personNotes.map((r) => r.note.id);
  let frequentTopics: string[] = [];
  if (noteIds.length > 0) {
    const allTopics = await db
      .select()
      .from(topics)
      .where(inArray(topics.noteId, noteIds));

    const topicCounts: Record<string, number> = {};
    allTopics.forEach((t) => { topicCounts[t.label] = (topicCounts[t.label] ?? 0) + 1; });
    frequentTopics = Object.entries(topicCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([label]) => label);
  }

  const sentiments = personNotes.map((r) => r.note.sentiment).filter(Boolean);
  const sentimentCounts: Record<string, number> = {};
  sentiments.forEach((s) => { sentimentCounts[s] = (sentimentCounts[s] ?? 0) + 1; });
  const dominantSentiment = Object.entries(sentimentCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "neutral";

  let avgDaysBetweenContacts: number | null = null;
  if (personNotes.length >= 2) {
    const dates = personNotes.map((r) => r.note.recordedAt.getTime()).sort();
    const intervals = dates.slice(1).map((d, i) => (d - dates[i]) / 86400000);
    avgDaysBetweenContacts = Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length);
  }

  return c.json({
    ...person,
    personalNotes: person.notes || null,
    notes: personNotes.map((r) => r.note),
    commitments: personCommitments,
    insights: {
      frequentTopics,
      dominantSentiment,
      avgDaysBetweenContacts,
      openCommitments: personCommitments.filter((c) => c.status === "open").length,
    },
  });
});

// Create person manually
app.post("/", async (c) => {
  const userId = c.get("userId") as string;
  const { name, relationship, keywords, phone, email, organization, role } = await c.req.json<{
    name: string;
    relationship?: string;
    keywords?: string[];
    phone?: string;
    email?: string;
    organization?: string;
    role?: string;
  }>();

  if (!name?.trim()) return c.json({ error: "Name required" }, 400);

  const [person] = await db
    .insert(people)
    .values({
      userId,
      name: name.trim(),
      relationship: relationship?.trim() ?? "",
      keywords: keywords ?? [],
      phone: phone?.trim() || null,
      email: email?.trim() || null,
      organization: organization?.trim() || null,
      role: role?.trim() || null,
    })
    .returning();

  return c.json(person, 201);
});

// Update person
app.patch("/:id", async (c) => {
  const userId = c.get("userId") as string;
  const personId = c.req.param("id");
  const body = await c.req.json<{
    name?: string;
    relationship?: string;
    keywords?: string[];
    phone?: string | null;
    email?: string | null;
    organization?: string | null;
    role?: string | null;
    notes?: string;
  }>();

  const updates: Record<string, any> = {};
  if (body.name !== undefined) updates.name = body.name.trim();
  if (body.relationship !== undefined) updates.relationship = body.relationship.trim();
  if (body.keywords !== undefined) updates.keywords = body.keywords;
  if (body.phone !== undefined) updates.phone = body.phone?.trim() || null;
  if (body.email !== undefined) updates.email = body.email?.trim() || null;
  if (body.organization !== undefined) updates.organization = body.organization?.trim() || null;
  if (body.role !== undefined) updates.role = body.role?.trim() || null;
  if (body.notes !== undefined) updates.notes = body.notes;

  if (Object.keys(updates).length === 0) return c.json({ error: "Nothing to update" }, 400);

  const [updated] = await db
    .update(people)
    .set(updates)
    .where(and(eq(people.id, personId), eq(people.userId, userId)))
    .returning();

  if (!updated) return c.json({ error: "Not found" }, 404);
  return c.json(updated);
});

// Get timeline for person (all touchpoints in chronological order)
app.get("/:id/timeline", async (c) => {
  const userId = c.get("userId") as string;
  const personId = c.req.param("id");

  const [person] = await db
    .select()
    .from(people)
    .where(and(eq(people.id, personId), eq(people.userId, userId)));

  if (!person) return c.json({ error: "Not found" }, 404);

  const personNotes = await db
    .select({ note: notes })
    .from(notePeople)
    .innerJoin(notes, eq(notePeople.noteId, notes.id))
    .where(eq(notePeople.personId, personId))
    .orderBy(desc(notes.recordedAt));

  const personCommitments = await db
    .select()
    .from(commitments)
    .where(eq(commitments.personId, personId));

  const noteIds = personNotes.map((r) => r.note.id);
  let personQuotes: typeof quotes.$inferSelect[] = [];
  if (noteIds.length > 0) {
    personQuotes = await db
      .select()
      .from(quotes)
      .where(inArray(quotes.noteId, noteIds));
  }

  const events: Array<{
    type: "conversation" | "commitment_created" | "commitment_completed" | "quote";
    date: string;
    noteId?: string;
    title?: string;
    summary?: string;
    sentiment?: string;
    description?: string;
    owner?: string;
    status?: string;
    text?: string;
    speaker?: string;
  }> = [];

  for (const { note } of personNotes) {
    events.push({
      type: "conversation",
      date: note.recordedAt.toISOString(),
      noteId: note.id,
      title: note.title || "Untitled",
      summary: note.summary,
      sentiment: note.sentiment,
    });
  }

  for (const c of personCommitments) {
    events.push({
      type: "commitment_created",
      date: c.createdAt.toISOString(),
      noteId: c.noteId ?? undefined,
      description: c.description,
      owner: c.owner,
      status: c.status,
    });
    if (c.completedAt) {
      events.push({
        type: "commitment_completed",
        date: c.completedAt.toISOString(),
        description: c.description,
        owner: c.owner,
        status: c.status,
      });
    }
  }

  for (const q of personQuotes) {
    events.push({
      type: "quote",
      date: q.createdAt.toISOString(),
      noteId: q.noteId,
      text: q.text,
      speaker: q.speaker,
    });
  }

  events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return c.json(events);
});

// Delete person
app.delete("/:id", async (c) => {
  const userId = c.get("userId") as string;
  const personId = c.req.param("id");

  await db.delete(people).where(and(eq(people.id, personId), eq(people.userId, userId)));
  return c.json({ ok: true });
});

export default app;
