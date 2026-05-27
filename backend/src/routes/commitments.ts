import { Hono } from "hono";
import { db } from "../services/db.js";
import { commitments, people } from "../models/schema.js";
import { eq, and } from "drizzle-orm";
import { AppEnv } from "../types.js";

const app = new Hono<AppEnv>();

// Export all commitments as CSV
app.get("/export", async (c) => {
  const userId = c.get("userId") as string;

  const results = await db
    .select()
    .from(commitments)
    .where(eq(commitments.userId, userId));

  results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const enriched = await Promise.all(
    results.map(async (c) => {
      let personName: string | null = null;
      if (c.personId) {
        const [p] = await db.select().from(people).where(eq(people.id, c.personId));
        personName = p?.name ?? null;
      }
      return { ...c, personName };
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

  const headers = ["Description", "Owner", "Status", "Due Date", "Person", "Created At"];
  const rows = enriched.map((c) => [
    escapeCSV(c.description),
    escapeCSV(c.owner),
    escapeCSV(c.status),
    escapeCSV(c.dueDate ? new Date(c.dueDate).toISOString().split("T")[0] : null),
    escapeCSV(c.personName),
    escapeCSV(c.createdAt ? new Date(c.createdAt).toISOString().split("T")[0] : null),
  ].join(","));

  const csv = [headers.join(","), ...rows].join("\n");

  c.header("Content-Type", "text/csv");
  c.header("Content-Disposition", "attachment; filename=recap-commitments.csv");
  return c.body(csv);
});

// Get all commitments with enriched data
app.get("/", async (c) => {
  const userId = c.get("userId") as string;
  const status = c.req.query("status");
  const owner = c.req.query("owner");
  const sort = c.req.query("sort") || "createdAt";

  const results = await db
    .select()
    .from(commitments)
    .where(eq(commitments.userId, userId));

  let filtered = results;
  if (status) filtered = filtered.filter((c) => c.status === status);
  if (owner) filtered = filtered.filter((c) => c.owner === owner);

  // Sort
  if (sort === "dueDate") {
    filtered.sort((a, b) => {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    });
  } else {
    filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  // Enrich with person name
  const enriched = await Promise.all(
    filtered.map(async (c) => {
      let person = null;
      if (c.personId) {
        const [p] = await db.select().from(people).where(eq(people.id, c.personId));
        person = p ? { id: p.id, name: p.name } : null;
      }
      return { ...c, person };
    })
  );

  return c.json(enriched);
});

// Create commitment manually
app.post("/", async (c) => {
  const userId = c.get("userId") as string;
  const body = await c.req.json<{
    description: string;
    personId?: string;
    owner?: "me" | "them";
    dueDate?: string;
    priority?: "low" | "medium" | "high";
  }>();

  if (!body.description?.trim()) return c.json({ error: "Description required" }, 400);

  const [commitment] = await db
    .insert(commitments)
    .values({
      userId,
      description: body.description.trim(),
      personId: body.personId || null,
      owner: body.owner ?? "me",
      dueDate: body.dueDate ? new Date(body.dueDate) : null,
      priority: body.priority ?? "medium",
    })
    .returning();

  return c.json(commitment, 201);
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
