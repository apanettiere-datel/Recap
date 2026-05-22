import { Hono } from "hono";
import { db } from "../services/db.js";
import { insights, weeklyReports } from "../models/schema.js";
import { eq, and, desc } from "drizzle-orm";
import { generateInsights, generateWeeklyReport } from "../services/insights.js";
import { chatWithNotes } from "../services/chat.js";
import { AppEnv } from "../types.js";

const app = new Hono<AppEnv>();

// Get insights
app.get("/", async (c) => {
  const userId = c.get("userId") as string;

  const userInsights = await db
    .select()
    .from(insights)
    .where(and(eq(insights.userId, userId), eq(insights.isDismissed, false)))
    .orderBy(desc(insights.generatedAt));

  return c.json(userInsights);
});

// Refresh insights
app.post("/refresh", async (c) => {
  const userId = c.get("userId") as string;
  const result = await generateInsights(userId);
  return c.json(result);
});

// Dismiss insight
app.patch("/:id/dismiss", async (c) => {
  const userId = c.get("userId") as string;
  const insightId = c.req.param("id");

  await db
    .update(insights)
    .set({ isDismissed: true })
    .where(and(eq(insights.id, insightId), eq(insights.userId, userId)));

  return c.json({ ok: true });
});

// Get weekly reports
app.get("/reports", async (c) => {
  const userId = c.get("userId") as string;

  const reports = await db
    .select()
    .from(weeklyReports)
    .where(eq(weeklyReports.userId, userId))
    .orderBy(desc(weeklyReports.generatedAt))
    .limit(10);

  return c.json(reports);
});

// Generate weekly report
app.post("/reports/generate", async (c) => {
  const userId = c.get("userId") as string;
  const report = await generateWeeklyReport(userId);
  return c.json(report);
});

// Chat with notes
app.post("/chat", async (c) => {
  const userId = c.get("userId") as string;
  const { message } = await c.req.json<{ message: string }>();

  if (!message?.trim()) return c.json({ error: "Message required" }, 400);

  const reply = await chatWithNotes(userId, message);
  return c.json({ reply });
});

export default app;
