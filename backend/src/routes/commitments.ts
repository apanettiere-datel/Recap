import { Hono } from "hono";
import { db } from "../services/db.js";
import { commitments } from "../models/schema.js";
import { eq, and } from "drizzle-orm";
import { AppEnv } from "../types.js";

const app = new Hono<AppEnv>();

// Get all commitments
app.get("/", async (c) => {
  const userId = c.get("userId") as string;
  const status = c.req.query("status"); // open, completed, overdue

  let query = db.select().from(commitments).where(eq(commitments.userId, userId));

  const results = await query;
  const filtered = status ? results.filter((c) => c.status === status) : results;

  return c.json(filtered);
});

// Update commitment status
app.patch("/:id", async (c) => {
  const userId = c.get("userId") as string;
  const commitmentId = c.req.param("id");
  const body = await c.req.json<{
    status?: "open" | "completed" | "overdue";
    dueDate?: string | null;
    addedToCalendar?: boolean;
    description?: string;
  }>();

  const updates: Record<string, unknown> = {};
  if (body.status) {
    updates.status = body.status;
    if (body.status === "completed") updates.completedAt = new Date();
    if (body.status === "open") updates.completedAt = null;
  }
  if (body.dueDate !== undefined) {
    updates.dueDate = body.dueDate ? new Date(body.dueDate) : null;
  }
  if (body.addedToCalendar !== undefined) {
    updates.addedToCalendar = body.addedToCalendar;
  }
  if (body.description !== undefined) {
    updates.description = body.description;
  }

  const [updated] = await db
    .update(commitments)
    .set(updates)
    .where(and(eq(commitments.id, commitmentId), eq(commitments.userId, userId)))
    .returning();

  if (!updated) return c.json({ error: "Not found" }, 404);
  return c.json(updated);
});

export default app;
