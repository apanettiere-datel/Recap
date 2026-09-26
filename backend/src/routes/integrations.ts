import { Hono } from "hono";
import { and, eq, isNull, ne } from "drizzle-orm";
import { db } from "../services/db.js";
import { commitments, notes, people, users } from "../models/schema.js";
import { AppEnv } from "../types.js";
import {
  IntegrationError, addTodoistTask, createNotionPage, parseNotionPageId, verifyNotion, verifyTodoist,
} from "../services/integrations.js";
import { loadExportNotes } from "../services/export.js";
import { APP_URL } from "../services/digest.js";

/** Todoist (action items) and Notion (conversation pages), connected with personal tokens. */
const app = new Hono<AppEnv>();

function isUuid(v: string | undefined): v is string {
  return !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

async function currentUser(userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  return user;
}

function summary(user: typeof users.$inferSelect) {
  return {
    todoist: { connected: !!user.todoistToken },
    notion: { connected: !!user.notionToken, pageTitle: user.notionParentTitle, pageId: user.notionParentId },
  };
}

function fail(c: { json: (b: unknown, s: number) => Response }, err: unknown) {
  if (err instanceof IntegrationError) return c.json({ error: err.message }, err.status);
  console.error("[integrations] failed:", err);
  return c.json({ error: "Something went wrong. Please try again." }, 500);
}

app.get("/", async (c) => {
  const user = await currentUser(c.get("userId"));
  return user ? c.json(summary(user)) : c.json({ error: "User not found" }, 404);
});

// PUT /api/integrations/todoist { token }
app.put("/todoist", async (c) => {
  const body = await c.req.json<{ token?: string }>().catch(() => null);
  const token = body?.token?.trim() ?? "";
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return c.json({ error: "That doesn't look like a Todoist API token." }, 400);
  try {
    await verifyTodoist(token);
  } catch (err) {
    return fail(c, err);
  }
  const [user] = await db.update(users).set({ todoistToken: token }).where(eq(users.id, c.get("userId"))).returning();
  return c.json(summary(user));
});

app.delete("/todoist", async (c) => {
  const [user] = await db.update(users).set({ todoistToken: null }).where(eq(users.id, c.get("userId"))).returning();
  return c.json(summary(user));
});

// PUT /api/integrations/notion { token, page }
app.put("/notion", async (c) => {
  const body = await c.req.json<{ token?: string; page?: string }>().catch(() => null);
  const token = body?.token?.trim() ?? "";
  const pageId = parseNotionPageId(body?.page ?? "");
  if (!/^(secret_|ntn_)[A-Za-z0-9]{20,}$/.test(token)) return c.json({ error: "That doesn't look like a Notion integration secret (it starts with ntn_ or secret_)." }, 400);
  if (!pageId) return c.json({ error: "Paste the link to the Notion page Recap should save conversations under." }, 400);
  try {
    const title = await verifyNotion(token, pageId);
    const [user] = await db
      .update(users)
      .set({ notionToken: token, notionParentId: pageId, notionParentTitle: title.slice(0, 200) })
      .where(eq(users.id, c.get("userId")))
      .returning();
    return c.json(summary(user));
  } catch (err) {
    return fail(c, err);
  }
});

app.delete("/notion", async (c) => {
  const [user] = await db
    .update(users)
    .set({ notionToken: null, notionParentId: null, notionParentTitle: null })
    .where(eq(users.id, c.get("userId")))
    .returning();
  return c.json(summary(user));
});

async function sendCommitment(token: string, row: { commitment: typeof commitments.$inferSelect; title: string | null; personName: string | null }) {
  const c = row.commitment;
  const context = [
    row.title ? `From the conversation “${row.title}”` : "",
    c.owner === "them" && row.personName ? `${row.personName} committed to this.` : row.personName ? `With ${row.personName}.` : "",
    c.noteId ? `${APP_URL()}/note/${c.noteId}` : "",
  ].filter(Boolean).join("\n");
  const task = await addTodoistTask(token, {
    content: c.owner === "them" && row.personName ? `Follow up: ${row.personName} — ${c.description}` : c.description,
    description: context,
    dueDate: c.dueDate,
  });
  await db.update(commitments).set({ todoistTaskId: task.id || "sent" }).where(eq(commitments.id, c.id));
  return task;
}

// Send one action item: POST /api/integrations/todoist/commitments/:id
app.post("/todoist/commitments/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  if (!isUuid(id)) return c.json({ error: "Not found" }, 404);
  const user = await currentUser(userId);
  if (!user?.todoistToken) return c.json({ error: "Connect Todoist in Settings first." }, 400);
  const [row] = await db
    .select({ commitment: commitments, title: notes.title, personName: people.name })
    .from(commitments)
    .leftJoin(notes, eq(commitments.noteId, notes.id))
    .leftJoin(people, eq(commitments.personId, people.id))
    .where(and(eq(commitments.id, id), eq(commitments.userId, userId)));
  if (!row) return c.json({ error: "Not found" }, 404);
  try {
    const task = await sendCommitment(user.todoistToken, row);
    return c.json({ ok: true, url: task.url });
  } catch (err) {
    return fail(c, err);
  }
});

// Send a conversation's open action items that haven't been sent yet
app.post("/todoist/notes/:id", async (c) => {
  const userId = c.get("userId");
  const noteId = c.req.param("id");
  if (!isUuid(noteId)) return c.json({ error: "Not found" }, 404);
  const user = await currentUser(userId);
  if (!user?.todoistToken) return c.json({ error: "Connect Todoist in Settings first." }, 400);
  const rows = await db
    .select({ commitment: commitments, title: notes.title, personName: people.name })
    .from(commitments)
    .innerJoin(notes, eq(commitments.noteId, notes.id))
    .leftJoin(people, eq(commitments.personId, people.id))
    .where(and(eq(commitments.noteId, noteId), eq(commitments.userId, userId), ne(commitments.status, "completed"), isNull(commitments.todoistTaskId)));
  let sent = 0;
  try {
    for (const row of rows) {
      await sendCommitment(user.todoistToken, row);
      sent++;
    }
  } catch (err) {
    if (sent === 0) return fail(c, err);
    return c.json({ ok: false, sent, error: (err as Error).message }, 207);
  }
  return c.json({ ok: true, sent });
});

// Save a conversation as a Notion page: POST /api/integrations/notion/notes/:id { transcript? }
app.post("/notion/notes/:id", async (c) => {
  const userId = c.get("userId");
  const noteId = c.req.param("id");
  if (!isUuid(noteId)) return c.json({ error: "Not found" }, 404);
  const body = await c.req.json<{ transcript?: boolean }>().catch(() => ({} as { transcript?: boolean }));
  const user = await currentUser(userId);
  if (!user?.notionToken || !user.notionParentId) return c.json({ error: "Connect Notion in Settings first." }, 400);
  const [note] = await loadExportNotes(userId, [noteId]);
  if (!note) return c.json({ error: "Not found" }, 404);
  try {
    const url = await createNotionPage(user.notionToken, user.notionParentId, note, !!body.transcript);
    await db.update(notes).set({ notionPageUrl: url }).where(eq(notes.id, noteId));
    return c.json({ ok: true, url });
  } catch (err) {
    return fail(c, err);
  }
});

export default app;
