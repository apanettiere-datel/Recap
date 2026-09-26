import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "./db.js";
import { commitments, noteProjects, notePeople, notes, people, projects, type ProjectStatus } from "../models/schema.js";
import { chatJSON } from "./ai.js";

/**
 * Projects group conversations about one piece of work. Each project keeps an AI
 * status (overview, decisions, open questions, next steps, what changed in the latest
 * conversation) that is rebuilt in the background whenever its conversations change.
 */

export const PROJECT_COLORS = ["blue", "emerald", "amber", "rose", "violet", "cyan", "orange", "slate"] as const;

/** Active projects, for the analysis prompt (so new recordings are filed automatically). */
export async function projectHints(userId: string) {
  return db
    .select({ name: projects.name, description: projects.description })
    .from(projects)
    .where(and(eq(projects.userId, userId), isNull(projects.archivedAt)))
    .orderBy(desc(projects.createdAt))
    .limit(40);
}

/** File a processed conversation under the projects the analysis named (exact names only). */
export async function assignProjectsFromAnalysis(userId: string, noteId: string, names: string[]) {
  const active = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(and(eq(projects.userId, userId), isNull(projects.archivedAt)));
  const wanted = new Set(names.map((n) => n.trim().toLowerCase()));

  // A re-analysis replaces earlier automatic guesses; choices the user made stay
  const current = await db.select().from(noteProjects).where(eq(noteProjects.noteId, noteId));
  const drop = current.filter((r) => r.auto && !active.some((p) => p.id === r.projectId && wanted.has(p.name.toLowerCase())));
  const add = active.filter((p) => wanted.has(p.name.toLowerCase()) && !current.some((r) => r.projectId === p.id));

  if (drop.length) {
    await db.delete(noteProjects).where(and(eq(noteProjects.noteId, noteId), inArray(noteProjects.projectId, drop.map((r) => r.projectId))));
  }
  if (add.length) {
    await db.insert(noteProjects).values(add.map((p) => ({ noteId, projectId: p.id, auto: true }))).onConflictDoNothing();
  }
  // The conversation's summary changed too, so every project it is (or was) in needs a new status
  const touched = [...current.map((r) => r.projectId), ...add.map((p) => p.id)];
  if (touched.length) markStale([...new Set(touched)]);
}

// ---------------------------------------------------------------------------
// Status: rebuilt in the background, debounced, one at a time per project
// ---------------------------------------------------------------------------

const timers = new Map<string, NodeJS.Timeout>();
const running = new Set<string>();
// After a failed rebuild, don't retry automatically for a while (a page open on the
// project would otherwise trigger a new AI call every few seconds)
const failedAt = new Map<string, number>();
const RETRY_AFTER_MS = 5 * 60 * 1000;

function recentlyFailed(projectId: string) {
  const at = failedAt.get(projectId);
  return !!at && Date.now() - at < RETRY_AFTER_MS;
}

/** Mark projects out of date and rebuild their status shortly. */
export function markStale(projectIds: string[], delayMs = 4000) {
  if (projectIds.length === 0) return;
  db.update(projects).set({ statusStale: true }).where(inArray(projects.id, projectIds))
    .catch((e) => console.warn("[projects] could not mark stale:", (e as Error).message));
  for (const id of projectIds) scheduleRefresh(id, delayMs);
}

export function scheduleRefresh(projectId: string, delayMs = 4000) {
  clearTimeout(timers.get(projectId));
  const t = setTimeout(() => {
    timers.delete(projectId);
    refreshProjectStatus(projectId).catch((e) => {
      failedAt.set(projectId, Date.now());
      console.warn(`[projects] status refresh failed for ${projectId}:`, (e as Error).message);
    });
  }, delayMs);
  t.unref?.();
  timers.set(projectId, t);
}

export function isRefreshing(projectId: string) {
  return running.has(projectId) || timers.has(projectId);
}

function iso(d: Date | null | undefined) {
  return d ? d.toISOString().split("T")[0] : "";
}

function strings(v: unknown, max: number, maxLen = 400): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim().slice(0, maxLen)).slice(0, max);
}

export async function refreshProjectStatus(projectId: string) {
  if (running.has(projectId)) {
    // Another rebuild is in flight; run again after it so the newest change is included
    scheduleRefresh(projectId, 5000);
    return;
  }
  running.add(projectId);
  try {
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    if (!project) return;

    const rows = await db
      .select({ id: notes.id, title: notes.title, summary: notes.summary, recordedAt: notes.recordedAt, isProcessing: notes.isProcessing })
      .from(noteProjects)
      .innerJoin(notes, eq(noteProjects.noteId, notes.id))
      .where(eq(noteProjects.projectId, projectId))
      .orderBy(desc(notes.recordedAt))
      .limit(40);
    const convos = rows.filter((r) => !r.isProcessing && (r.summary.trim() || r.title.trim()));

    if (convos.length === 0) {
      await db.update(projects).set({ status: null, statusStale: false, statusUpdatedAt: new Date() }).where(eq(projects.id, projectId));
      return;
    }

    const ids = convos.map((c) => c.id);
    const items = await db
      .select({ noteId: commitments.noteId, description: commitments.description, owner: commitments.owner, status: commitments.status, dueDate: commitments.dueDate, person: people.name })
      .from(commitments)
      .leftJoin(people, eq(commitments.personId, people.id))
      .where(inArray(commitments.noteId, ids));

    // Oldest first, so the model reads the project's story in order
    const history = [...convos].reverse().map((c) => {
      const cs = items.filter((i) => i.noteId === c.id)
        .map((i) => `  - [${i.owner === "me" ? "me" : i.person || "them"}] ${i.description} (${i.status}${i.dueDate ? `, due ${iso(i.dueDate)}` : ""})`)
        .join("\n");
      return `### ${iso(c.recordedAt)} — ${c.title || "Untitled"}\n${c.summary}${cs ? `\nCommitments:\n${cs}` : ""}`;
    }).join("\n\n");
    const latest = convos[0];

    const raw = await chatJSON(
      "You keep a running status for a project, based on summaries of the conversations about it. Be concrete and brief. Respond with valid JSON.",
      `Project: ${project.name}
${project.description ? `Description: ${project.description}\n` : ""}Today: ${iso(new Date())}

Conversations about this project, oldest first:
${history.slice(-40000)}

Return JSON:
{
  "overview": "2-4 sentences: where the project stands right now",
  "decisions": ["decisions that have been made, most important first (max 8)"],
  "openQuestions": ["unresolved questions or undecided points (max 6)"],
  "risks": ["risks, blockers or concerns raised (max 5)"],
  "nextSteps": ["the next concrete steps, with who owns them when known (max 6)"],
  "latestChanges": "1-3 sentences on what the most recent conversation (${iso(latest.recordedAt)}, \\"${latest.title}\\") changed or added compared with before"
}
Only use what the conversations say. "me" is the user. Use [] when there is nothing for a list.`,
    );

    const status: ProjectStatus = {
      overview: typeof raw.overview === "string" ? raw.overview.trim().slice(0, 2000) : "",
      decisions: strings(raw.decisions, 8),
      openQuestions: strings(raw.openQuestions, 6),
      risks: strings(raw.risks, 5),
      nextSteps: strings(raw.nextSteps, 6),
      latest: {
        noteId: latest.id,
        title: latest.title,
        changes: typeof raw.latestChanges === "string" ? raw.latestChanges.trim().slice(0, 1200) : "",
      },
    };
    await db.update(projects).set({ status, statusStale: false, statusUpdatedAt: new Date() }).where(eq(projects.id, projectId));
    failedAt.delete(projectId);
    console.log(`[projects] status updated for ${projectId} (${convos.length} conversations)`);
  } finally {
    running.delete(projectId);
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function listProjects(userId: string, includeArchived = false) {
  const rows = await db
    .select()
    .from(projects)
    .where(includeArchived ? eq(projects.userId, userId) : and(eq(projects.userId, userId), isNull(projects.archivedAt)))
    .orderBy(desc(projects.createdAt));
  if (rows.length === 0) return [];
  const ids = rows.map((p) => p.id);

  const stats = await db
    .select({
      projectId: noteProjects.projectId,
      count: sql<number>`count(*)`.mapWith(Number),
      lastAt: sql<Date | null>`max(${notes.recordedAt})`,
    })
    .from(noteProjects)
    .innerJoin(notes, eq(noteProjects.noteId, notes.id))
    .where(inArray(noteProjects.projectId, ids))
    .groupBy(noteProjects.projectId);

  const open = await db
    .select({ projectId: noteProjects.projectId, count: sql<number>`count(distinct ${commitments.id})`.mapWith(Number) })
    .from(noteProjects)
    .innerJoin(commitments, eq(commitments.noteId, noteProjects.noteId))
    .where(and(inArray(noteProjects.projectId, ids), sql`${commitments.status} <> 'completed'`))
    .groupBy(noteProjects.projectId);

  const byId = new Map(stats.map((s) => [s.projectId, s]));
  const openById = new Map(open.map((o) => [o.projectId, o.count]));
  return rows
    .map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      color: p.color,
      archived: !!p.archivedAt,
      overview: p.status?.overview ?? "",
      conversationCount: byId.get(p.id)?.count ?? 0,
      lastConversationAt: byId.get(p.id)?.lastAt ? new Date(byId.get(p.id)!.lastAt as unknown as string) : null,
      openCommitments: openById.get(p.id) ?? 0,
      createdAt: p.createdAt,
    }))
    .sort((a, b) => (b.lastConversationAt?.getTime() ?? b.createdAt.getTime()) - (a.lastConversationAt?.getTime() ?? a.createdAt.getTime()));
}

export async function projectDetail(userId: string, projectId: string) {
  const [project] = await db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
  if (!project) return null;

  const convos = await db
    .select({
      id: notes.id,
      title: notes.title,
      summary: notes.summary,
      recordedAt: notes.recordedAt,
      duration: notes.duration,
      sentiment: notes.sentiment,
      isProcessing: notes.isProcessing,
      auto: noteProjects.auto,
    })
    .from(noteProjects)
    .innerJoin(notes, eq(noteProjects.noteId, notes.id))
    .where(eq(noteProjects.projectId, projectId))
    .orderBy(desc(notes.recordedAt));
  const ids = convos.map((c) => c.id);

  const [items, folks] = ids.length
    ? await Promise.all([
        db
          .select({ commitment: commitments, personName: people.name })
          .from(commitments)
          .leftJoin(people, eq(commitments.personId, people.id))
          .where(inArray(commitments.noteId, ids))
          .orderBy(desc(commitments.createdAt)),
        db
          .select({ id: people.id, name: people.name, relationship: people.relationship, count: sql<number>`count(distinct ${notePeople.noteId})`.mapWith(Number) })
          .from(notePeople)
          .innerJoin(people, eq(notePeople.personId, people.id))
          .where(inArray(notePeople.noteId, ids))
          .groupBy(people.id, people.name, people.relationship),
      ])
    : [[], []];

  // Nothing generated yet, or it went stale while the server was restarting
  const failed = recentlyFailed(project.id);
  if (project.statusStale && !isRefreshing(project.id) && !failed) scheduleRefresh(project.id, 500);

  return {
    id: project.id,
    name: project.name,
    description: project.description,
    color: project.color,
    archived: !!project.archivedAt,
    status: project.status,
    statusUpdatedAt: project.statusUpdatedAt,
    statusUpdating: isRefreshing(project.id) || (project.statusStale && !failed),
    statusError: failed && project.statusStale ? "Couldn't update the status. Try Refresh." : null,
    conversations: convos,
    commitments: items.map((r) => ({ ...r.commitment, personName: r.personName })),
    people: folks.sort((a, b) => b.count - a.count),
  };
}
