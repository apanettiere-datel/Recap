import { Hono } from "hono";
import { db } from "../services/db.js";
import { commitments, people, notes, notePeople, topics, quotes } from "../models/schema.js";
import { eq, and, desc, sql, inArray, lte, gte } from "drizzle-orm";
import { AppEnv } from "../types.js";

const app = new Hono<AppEnv>();

// Daily digest
app.get("/daily", async (c) => {
  const userId = c.get("userId") as string;

  // Get overdue commitments
  const allCommitments = await db
    .select()
    .from(commitments)
    .where(and(eq(commitments.userId, userId), eq(commitments.status, "open")));

  const now = new Date();
  const overdue = allCommitments.filter(
    (c) => c.dueDate && new Date(c.dueDate) < now
  );
  const dueSoon = allCommitments.filter((c) => {
    if (!c.dueDate) return false;
    const due = new Date(c.dueDate);
    const threeDays = new Date(now.getTime() + 3 * 86400000);
    return due >= now && due <= threeDays;
  });
  const open = allCommitments.filter(
    (c) => !overdue.includes(c) && !dueSoon.includes(c)
  );

  // Get people with stale contact (haven't talked in a while)
  const userPeople = await db
    .select()
    .from(people)
    .where(eq(people.userId, userId));

  const staleContacts = [];
  for (const person of userPeople) {
    const lastNote = await db
      .select({ recordedAt: notes.recordedAt })
      .from(notePeople)
      .innerJoin(notes, eq(notePeople.noteId, notes.id))
      .where(eq(notePeople.personId, person.id))
      .orderBy(desc(notes.recordedAt))
      .limit(1);

    if (lastNote.length > 0) {
      const daysSince = Math.floor(
        (now.getTime() - lastNote[0].recordedAt.getTime()) / 86400000
      );
      if (daysSince > 14) {
        staleContacts.push({
          ...person,
          daysSinceContact: daysSince,
          lastContactDate: lastNote[0].recordedAt,
        });
      }
    }
  }

  staleContacts.sort((a, b) => b.daysSinceContact - a.daysSinceContact);

  // Enrich commitments with person name
  const enrichCommitment = async (c: any) => {
    let person = null;
    if (c.personId) {
      const [p] = await db.select().from(people).where(eq(people.id, c.personId));
      person = p || null;
    }
    return { ...c, person };
  };

  const enrichedOverdue = await Promise.all(overdue.map(enrichCommitment));
  const enrichedDueSoon = await Promise.all(dueSoon.map(enrichCommitment));
  const enrichedOpen = await Promise.all(open.map(enrichCommitment));

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return c.json({
    today,
    overdue: enrichedOverdue,
    dueSoon: enrichedDueSoon,
    open: enrichedOpen,
    staleContacts: staleContacts.slice(0, 10),
    summary: {
      totalOverdue: overdue.length,
      totalDueSoon: dueSoon.length,
      totalOpen: allCommitments.length,
      totalStaleContacts: staleContacts.length,
    },
  });
});

// Pre-meeting briefing for a person
app.get("/person/:personId", async (c) => {
  const userId = c.get("userId") as string;
  const personId = c.req.param("personId");

  const [person] = await db
    .select()
    .from(people)
    .where(and(eq(people.id, personId), eq(people.userId, userId)));

  if (!person) return c.json({ error: "Not found" }, 404);

  // Recent notes with this person
  const recentNotes = await db
    .select({ note: notes })
    .from(notePeople)
    .innerJoin(notes, eq(notePeople.noteId, notes.id))
    .where(eq(notePeople.personId, personId))
    .orderBy(desc(notes.recordedAt))
    .limit(5);

  // Open commitments with this person
  const openCommitments = await db
    .select()
    .from(commitments)
    .where(
      and(
        eq(commitments.personId, personId),
        eq(commitments.userId, userId),
        eq(commitments.status, "open")
      )
    );

  // Overdue commitments
  const now = new Date();
  const overdueCommitments = openCommitments.filter(
    (c) => c.dueDate && new Date(c.dueDate) < now
  );

  // Key quotes from recent conversations
  const noteIds = recentNotes.map((r) => r.note.id);
  let recentQuotes: any[] = [];
  if (noteIds.length > 0) {
    recentQuotes = await db
      .select()
      .from(quotes)
      .where(inArray(quotes.noteId, noteIds))
      .limit(5);
  }

  // Topics from recent conversations
  let recentTopics: string[] = [];
  if (noteIds.length > 0) {
    const allTopics = await db
      .select()
      .from(topics)
      .where(inArray(topics.noteId, noteIds));

    const topicCounts: Record<string, number> = {};
    allTopics.forEach((t) => {
      topicCounts[t.label] = (topicCounts[t.label] ?? 0) + 1;
    });
    recentTopics = Object.entries(topicCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([label]) => label);
  }

  // Last conversation summary
  const lastNote = recentNotes[0]?.note ?? null;

  // Suggested talking points based on open commitments and recent topics
  const talkingPoints: string[] = [];
  if (overdueCommitments.length > 0) {
    talkingPoints.push(
      `Follow up on ${overdueCommitments.length} overdue commitment${overdueCommitments.length > 1 ? "s" : ""}`
    );
  }
  openCommitments.forEach((c) => {
    if (!overdueCommitments.includes(c)) {
      talkingPoints.push(`Check in on: ${c.description}`);
    }
  });

  return c.json({
    person,
    lastConversation: lastNote
      ? {
          id: lastNote.id,
          title: lastNote.title,
          summary: lastNote.summary,
          recordedAt: lastNote.recordedAt,
          sentiment: lastNote.sentiment,
        }
      : null,
    recentNotes: recentNotes.map((r) => ({
      id: r.note.id,
      title: r.note.title,
      summary: r.note.summary,
      recordedAt: r.note.recordedAt,
    })),
    openCommitments,
    overdueCommitments,
    recentQuotes,
    recentTopics,
    talkingPoints,
  });
});

export default app;
