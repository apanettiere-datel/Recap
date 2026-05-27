import "dotenv/config";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { authMiddleware } from "./middleware/auth.js";
import { rateLimiter, resolveUser, validateContentLength, errorHandler } from "./middleware/security.js";
import notesRoutes from "./routes/notes.js";
import peopleRoutes from "./routes/people.js";
import commitmentsRoutes from "./routes/commitments.js";
import insightsRoutes from "./routes/insights.js";
import usersRoutes from "./routes/users.js";
import briefingRoutes from "./routes/briefing.js";
import { startWeeklyJobs } from "./jobs/weekly.js";

const app = new Hono();

// Global middleware
app.use("*", errorHandler);
app.use("*", cors({
  origin: "*",
  allowMethods: ["GET", "POST", "PATCH", "DELETE"],
  allowHeaders: ["Authorization", "Content-Type"],
}));

// Request logging
app.use("*", async (c, next) => {
  const start = Date.now();
  await next();
  console.log(`[${c.req.method}] ${c.req.path} → ${c.res.status} (${Date.now() - start}ms)`);
});

// Health check (no auth)
app.get("/health", (c) => c.json({ status: "ok", version: "1.0.0" }));

// Auth required for all API routes
app.use("/api/*", authMiddleware);
app.use("/api/*", rateLimiter);

// User sync (before resolveUser since it creates the user)
app.route("/api/users", usersRoutes);

// All other routes need a resolved user
app.use("/api/notes", resolveUser);
app.use("/api/notes/*", resolveUser);
app.use("/api/people", resolveUser);
app.use("/api/people/*", resolveUser);
app.use("/api/commitments", resolveUser);
app.use("/api/commitments/*", resolveUser);
app.use("/api/insights", resolveUser);
app.use("/api/insights/*", resolveUser);
app.use("/api/briefing/*", resolveUser);

// Audio upload limit: 50MB
app.use("/api/notes", validateContentLength(50 * 1024 * 1024));

// Routes
app.route("/api/notes", notesRoutes);
app.route("/api/people", peopleRoutes);
app.route("/api/commitments", commitmentsRoutes);
app.route("/api/insights", insightsRoutes);
app.route("/api/briefing", briefingRoutes);

const port = parseInt(process.env.PORT ?? "3000");

serve({ fetch: app.fetch, port }, () => {
  console.log(`Recap API running on port ${port}`);
  startWeeklyJobs();
});
