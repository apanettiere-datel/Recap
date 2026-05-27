import OpenAI from "openai";
import { db } from "./db.js";
import { notes, commitments, people, topics, insights, weeklyReports, notePeople } from "../models/schema.js";
import { eq, and, gte, lt, sql, desc } from "drizzle-orm";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function generateInsights(userId: string) {
  const now = new Date();
  const twoWeeksAgo = new Date(now.getTime() - 14 * 86400000);
  const fourWeeksAgo = new Date(now.getTime() - 28 * 86400000);

  const allCommitments = await db
    .select()
    .from(commitments)
    .where(eq(commitments.userId, userId));

  const allPeople = await db
    .select()
    .from(people)
    .where(eq(people.userId, userId));

  const recentNotes = await db
    .select()
    .from(notes)
    .where(and(eq(notes.userId, userId), gte(notes.recordedAt, fourWeeksAgo)));

  const recentTopics = await db
    .select()
    .from(topics)
    .innerJoin(notes, eq(topics.noteId, notes.id))
    .where(and(eq(notes.userId, userId), gte(notes.recordedAt, fourWeeksAgo)));

  const generated: typeof insights.$inferInsert[] = [];

  // Overdue commitments — only flag if due date is recent (not LLM hallucinated old dates)
  for (const c of allCommitments) {
    if (c.status !== "open" || !c.dueDate || c.dueDate >= now) continue;
    const daysOverdue = Math.floor((now.getTime() - c.dueDate.getTime()) / 86400000);
    // Skip if due date is before the commitment was created (LLM set a bad date)
    if (c.dueDate < c.createdAt) continue;
    // Skip if overdue by more than 60 days (likely a hallucinated date)
    if (daysOverdue > 60) continue;
    const personName = allPeople.find((p) => p.id === c.personId)?.name ?? null;
    generated.push({
      userId,
      type: "overdue_commitment",
      priority: daysOverdue > 7 ? "urgent" : "high",
      title: `${c.owner === "me" ? "You" : "They"} have an overdue commitment${personName ? ` with ${personName}` : ""}`,
      body: `"${c.description}" was due ${daysOverdue} day${daysOverdue === 1 ? "" : "s"} ago.`,
      relatedPersonName: personName,
    });
  }

  // Upcoming deadlines (within 7 days)
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 86400000);
  for (const c of allCommitments) {
    if (c.status !== "open" || !c.dueDate) continue;
    if (c.dueDate < now || c.dueDate > sevenDaysFromNow) continue;
    const daysLeft = Math.floor((c.dueDate.getTime() - now.getTime()) / 86400000);
    generated.push({
      userId,
      type: "accountability",
      priority: daysLeft <= 1 ? "high" : daysLeft <= 3 ? "medium" : "low",
      title: `Deadline ${daysLeft === 0 ? "today" : `in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`}`,
      body: `"${c.description}" — ${c.owner === "me" ? "you own this" : "they own this"}.`,
      relatedPersonName: allPeople.find((p) => p.id === c.personId)?.name ?? null,
    });
  }

  // Relationship decay
  for (const person of allPeople) {
    const noteCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(notePeople)
      .where(eq(notePeople.personId, person.id));

    const total = Number(noteCount[0]?.count ?? 0);
    if (total < 2) continue;
    if (!person.lastContactDate || person.lastContactDate >= twoWeeksAgo) continue;

    const daysSince = Math.floor((now.getTime() - person.lastContactDate.getTime()) / 86400000);
    generated.push({
      userId,
      type: "relationship_decay",
      priority: daysSince > 30 ? "high" : "medium",
      title: `Haven't talked to ${person.name}`,
      body: `It's been ${daysSince} days since your last conversation. You usually talk more often.`,
      relatedPersonName: person.name,
    });
  }

  // Recurring unresolved topics
  const topicCounts: Record<string, number> = {};
  for (const row of recentTopics) {
    topicCounts[row.topics.label] = (topicCounts[row.topics.label] ?? 0) + 1;
  }
  for (const [label, count] of Object.entries(topicCounts)) {
    if (count < 3) continue;
    generated.push({
      userId,
      type: "recurring_topic",
      priority: count >= 5 ? "high" : "medium",
      title: `'${label}' keeps coming up`,
      body: `This topic has appeared in ${count} conversations over the last 4 weeks. Are you making progress or circling?`,
    });
  }

  // Dropped threads (old open commitments with no deadline)
  const oldOpen = allCommitments.filter(
    (c) => c.status === "open" && !c.dueDate && c.createdAt.getTime() < twoWeeksAgo.getTime()
  );
  for (const c of oldOpen.slice(0, 5)) {
    const daysSince = Math.floor((now.getTime() - c.createdAt.getTime()) / 86400000);
    generated.push({
      userId,
      type: "dropped_thread",
      priority: daysSince > 21 ? "high" : "medium",
      title: "Forgotten commitment?",
      body: `"${c.description}" was mentioned ${daysSince} days ago with no deadline. Still relevant?`,
      relatedPersonName: allPeople.find((p) => p.id === c.personId)?.name ?? null,
    });
  }

  // Activity summary when there's recent activity
  if (recentNotes.length > 0) {
    const uniquePeopleInNotes = new Set<string>();
    for (const n of recentNotes) {
      const linked = await db
        .select()
        .from(notePeople)
        .innerJoin(people, eq(notePeople.personId, people.id))
        .where(eq(notePeople.noteId, n.id));
      linked.forEach((r) => uniquePeopleInNotes.add(r.people.name));
    }
    const openCount = allCommitments.filter((c) => c.status === "open").length;
    const topTopics = Object.entries(topicCounts).sort((a, b) => b[1] - a[1]).slice(0, 3);

    generated.push({
      userId,
      type: "activity_summary",
      priority: "low",
      title: `${recentNotes.length} conversation${recentNotes.length === 1 ? "" : "s"} in the last 4 weeks`,
      body: [
        uniquePeopleInNotes.size > 0 ? `You've talked with ${[...uniquePeopleInNotes].join(", ")}.` : null,
        openCount > 0 ? `${openCount} open commitment${openCount === 1 ? "" : "s"} to track.` : null,
        topTopics.length > 0 ? `Top topics: ${topTopics.map(([t]) => t).join(", ")}.` : null,
      ].filter(Boolean).join(" "),
    });
  }

  // Clear old insights, insert new ones
  await db.delete(insights).where(eq(insights.userId, userId));
  if (generated.length > 0) {
    await db.insert(insights).values(generated);
  }

  return generated;
}

export async function generateWeeklyReport(userId: string) {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86400000);

  const weekNotes = await db
    .select()
    .from(notes)
    .where(and(eq(notes.userId, userId), gte(notes.recordedAt, weekAgo)))
    .orderBy(notes.recordedAt);

  const allCommitments = await db
    .select()
    .from(commitments)
    .where(eq(commitments.userId, userId));

  const weekCommitments = allCommitments.filter(
    (c) => c.createdAt.getTime() >= weekAgo.getTime()
  );

  const overdue = allCommitments.filter(
    (c) => c.status === "open" && c.dueDate && c.dueDate < now
  );

  const allPeople = await db.select().from(people).where(eq(people.userId, userId));
  const decaying = allPeople.filter(
    (p) => p.lastContactDate && p.lastContactDate < new Date(now.getTime() - 14 * 86400000)
  );

  // Build AI prompt
  const fmtDate = (d: Date) => d.toISOString().split("T")[0];

  const notesSummary = weekNotes
    .map((n) => `- ${fmtDate(n.recordedAt)}: ${n.summary}`)
    .join("\n");

  const overdueText = overdue
    .map((c) => `- ${c.description} (${c.owner}, due ${c.dueDate ? fmtDate(c.dueDate) : "unknown"})`)
    .join("\n");

  const decayingText = decaying
    .map((p) => `- ${p.name} (last: ${p.lastContactDate ? fmtDate(p.lastContactDate) : "unknown"})`)
    .join("\n");

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.4,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "You are a direct personal accountability coach. Analyze conversation patterns and surface uncomfortable truths. Respond with valid JSON.",
      },
      {
        role: "user",
        content: `Generate a weekly report. Today is ${fmtDate(now)}. The reporting period is ${fmtDate(weekAgo)} to ${fmtDate(now)}. Be brutally honest and specific — use names and dates.

Return JSON:
{
  "narrative": "4-6 sentence overview of the week",
  "dropped_threads": ["commitments/topics not followed up on"],
  "avoided_topics": ["topics deflected or unresolved"],
  "suggestions": ["3-5 specific actions for next week"]
}

Conversations this week:
${notesSummary || "None recorded."}

Overdue commitments:
${overdueText || "None."}

Fading relationships:
${decayingText || "None."}`,
      },
    ],
  });

  const ai = JSON.parse(response.choices[0].message.content!) as {
    narrative: string;
    dropped_threads: string[];
    avoided_topics: string[];
    suggestions: string[];
  };

  const uniquePeople = new Set<string>();
  for (const n of weekNotes) {
    const linked = await db
      .select()
      .from(notePeople)
      .innerJoin(people, eq(notePeople.personId, people.id))
      .where(eq(notePeople.noteId, n.id));
    linked.forEach((r) => uniquePeople.add(r.people.name));
  }

  const weekTopics = await db
    .select()
    .from(topics)
    .innerJoin(notes, eq(topics.noteId, notes.id))
    .where(and(eq(notes.userId, userId), gte(notes.recordedAt, weekAgo)));

  const topicCounts: Record<string, number> = {};
  weekTopics.forEach((r) => { topicCounts[r.topics.label] = (topicCounts[r.topics.label] ?? 0) + 1; });
  const topTopics = Object.entries(topicCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([label]) => label);

  const [report] = await db
    .insert(weeklyReports)
    .values({
      userId,
      weekStarting: weekAgo,
      narrative: ai.narrative,
      commitmentsMade: weekCommitments.length,
      commitmentsCompleted: weekCommitments.filter((c) => c.status === "completed").length,
      commitmentsOverdue: overdue.length,
      conversationCount: weekNotes.length,
      uniquePeopleCount: uniquePeople.size,
      topTopics,
      droppedThreads: ai.dropped_threads,
      avoidedTopics: ai.avoided_topics,
      suggestedFocus: ai.suggestions,
    })
    .returning();

  return report;
}
