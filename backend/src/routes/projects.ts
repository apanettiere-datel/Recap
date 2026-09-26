import { Hono } from "hono";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../services/db.js";
import { noteProjects, notes, projects } from "../models/schema.js";
import { AppEnv } from "../types.js";
import { PROJECT_COLORS, listProjects, markStale, projectDetail, refreshProjectStatus } from "../services/projects.js";

const app = new Hono<AppEnv>();

function isUuid(v: string | undefined): v is string {
  return !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function cleanName(v: unknown) {
  return typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, 80) : "";
}

async function owned(userId: string, projectId: string) {
  if (!isUuid(projectId)) return null;
  const [p] = await db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
  return p ?? null;
}

async function nameTaken(userId: string, name: string, exceptId?: string) {
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.userId, userId), sql`lower(${projects.name}) = ${name.toLowerCase()}`, exceptId ? sql`${projects.id} <> ${exceptId}` : sql`true`))
    .limit(1);
  return !!row;
}

// GET /api/projects?archived=include
app.get("/", async (c) => {
  return c.json(await listProjects(c.get("userId"), c.req.query("archived") === "include"));
});

// POST /api/projects { name, description?, color?, noteIds? }
app.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  const name = cleanName(body?.name);
  if (!name) return c.json({ error: "Give the project a name." }, 400);
  if (await nameTaken(userId, name)) return c.json({ error: "You already have a project with that name." }, 409);
  const color = PROJECT_COLORS.includes(body?.color as never) ? (body!.color as string) : PROJECT_COLORS[Math.floor(Math.random() * 6)];

  const [project] = await db
    .insert(projects)
    .values({ userId, name, description: typeof body?.description === "string" ? body.description.trim().slice(0, 1000) : "", color, statusStale: false })
    .returning();

  // Optionally start with some conversations (e.g. "new project from this conversation")
  const noteIds = Array.isArray(body?.noteIds) ? body!.noteIds.filter((id): id is string => typeof id === "string" && isUuid(id)).slice(0, 200) : [];
  if (noteIds.length) {
    const mine = await db.select({ id: notes.id }).from(notes).where(and(eq(notes.userId, userId), inArray(notes.id, noteIds)));
    if (mine.length) {
      await db.insert(noteProjects).values(mine.map((n) => ({ noteId: n.id, projectId: project.id }))).onConflictDoNothing();
      markStale([project.id], 500);
    }
  }
  return c.json(project, 201);
});

app.get("/:id", async (c) => {
  const id = c.req.param("id");
  if (!isUuid(id)) return c.json({ error: "Not found" }, 404);
  const detail = await projectDetail(c.get("userId"), id);
  return detail ? c.json(detail) : c.json({ error: "Not found" }, 404);
});

// PATCH /api/projects/:id { name?, description?, color?, archived? }
app.patch("/:id", async (c) => {
  const userId = c.get("userId");
  const project = await owned(userId, c.req.param("id"));
  if (!project) return c.json({ error: "Not found" }, 404);
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body) return c.json({ error: "Invalid request body" }, 400);

  const updates: Partial<typeof projects.$inferInsert> = {};
  if (body.name !== undefined) {
    const name = cleanName(body.name);
    if (!name) return c.json({ error: "Give the project a name." }, 400);
    if (await nameTaken(userId, name, project.id)) return c.json({ error: "You already have a project with that name." }, 409);
    updates.name = name;
  }
  if (typeof body.description === "string") updates.description = body.description.trim().slice(0, 1000);
  if (PROJECT_COLORS.includes(body.color as never)) updates.color = body.color as string;
  if (typeof body.archived === "boolean") updates.archivedAt = body.archived ? new Date() : null;
  if (Object.keys(updates).length === 0) return c.json({ error: "No fields to update" }, 400);

  const [updated] = await db.update(projects).set(updates).where(eq(projects.id, project.id)).returning();
  if (updates.name || updates.description !== undefined) markStale([project.id]);
  return c.json(updated);
});

app.delete("/:id", async (c) => {
  const project = await owned(c.get("userId"), c.req.param("id"));
  if (!project) return c.json({ error: "Not found" }, 404);
  // Conversations stay; only the grouping goes
  await db.delete(projects).where(eq(projects.id, project.id));
  return c.json({ ok: true });
});

// POST /api/projects/:id/notes { noteId }
app.post("/:id/notes", async (c) => {
  const userId = c.get("userId");
  const project = await owned(userId, c.req.param("id"));
  if (!project) return c.json({ error: "Not found" }, 404);
  const body = await c.req.json<{ noteId?: string }>().catch(() => null);
  if (!isUuid(body?.noteId)) return c.json({ error: "Choose a conversation" }, 400);
  const [note] = await db.select({ id: notes.id }).from(notes).where(and(eq(notes.id, body!.noteId!), eq(notes.userId, userId)));
  if (!note) return c.json({ error: "Not found" }, 404);

  // Adding by hand confirms an automatic assignment
  await db
    .insert(noteProjects)
    .values({ noteId: note.id, projectId: project.id, auto: false })
    .onConflictDoUpdate({ target: [noteProjects.noteId, noteProjects.projectId], set: { auto: false } });
  markStale([project.id]);
  return c.json({ ok: true });
});

app.delete("/:id/notes/:noteId", async (c) => {
  const project = await owned(c.get("userId"), c.req.param("id"));
  const noteId = c.req.param("noteId");
  if (!project || !isUuid(noteId)) return c.json({ error: "Not found" }, 404);
  await db.delete(noteProjects).where(and(eq(noteProjects.projectId, project.id), eq(noteProjects.noteId, noteId)));
  markStale([project.id]);
  return c.json({ ok: true });
});

// Rebuild the status now: POST /api/projects/:id/refresh
app.post("/:id/refresh", async (c) => {
  const project = await owned(c.get("userId"), c.req.param("id"));
  if (!project) return c.json({ error: "Not found" }, 404);
  await db.update(projects).set({ statusStale: true }).where(eq(projects.id, project.id));
  try {
    await refreshProjectStatus(project.id);
  } catch (err) {
    console.error("[projects] refresh failed:", err);
    return c.json({ error: "Couldn't update the project status right now. Please try again." }, 502);
  }
  return c.json(await projectDetail(c.get("userId"), project.id));
});

export default app;
