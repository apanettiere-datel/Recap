import { Hono } from "hono";
import { db } from "../services/db.js";
import { people, commitments, notes, notePeople, topics } from "../models/schema.js";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { AppEnv } from "../types.js";

const app = new Hono<AppEnv>();

// Get all people
app.get("/", async (c) => {
  const userId = c.get("userId") as string;

  const userPeople = await db
    .select()
    .from(people)
    .where(eq(people.userId, userId))
    .orderBy(people.name);

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
  const { name, relationship, keywords, phone, email, organization } = await c.req.json<{
    name: string;
    relationship?: string;
    keywords?: string[];
    phone?: string;
    email?: string;
    organization?: string;
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
  }>();

  const updates: Record<string, any> = {};
  if (body.name !== undefined) updates.name = body.name.trim();
  if (body.relationship !== undefined) updates.relationship = body.relationship.trim();
  if (body.keywords !== undefined) updates.keywords = body.keywords;

  if (Object.keys(updates).length === 0) return c.json({ error: "Nothing to update" }, 400);

  const [updated] = await db
    .update(people)
    .set(updates)
    .where(and(eq(people.id, personId), eq(people.userId, userId)))
    .returning();

  if (!updated) return c.json({ error: "Not found" }, 404);
  return c.json(updated);
});

// Delete person
app.delete("/:id", async (c) => {
  const userId = c.get("userId") as string;
  const personId = c.req.param("id");

  await db.delete(people).where(and(eq(people.id, personId), eq(people.userId, userId)));
  return c.json({ ok: true });
});

export default app;
