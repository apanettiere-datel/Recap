import cron from "node-cron";
import { db } from "../services/db.js";
import { users } from "../models/schema.js";
import { generateWeeklyReport, generateInsights } from "../services/insights.js";

export function startWeeklyJobs() {
  // Generate weekly reports every Sunday at 6 PM
  cron.schedule("0 18 * * 0", async () => {
    console.log("[cron] Generating weekly reports...");
    try {
      const allUsers = await db.select().from(users);
      for (const user of allUsers) {
        try {
          await generateWeeklyReport(user.id);
          console.log(`[cron] Weekly report generated for user ${user.id}`);
        } catch (err) {
          console.error(`[cron] Failed for user ${user.id}:`, err);
        }
      }
    } catch (err) {
      console.error("[cron] Weekly report job failed:", err);
    }
  });

  // Refresh insights daily at 8 AM
  cron.schedule("0 8 * * *", async () => {
    console.log("[cron] Refreshing insights...");
    try {
      const allUsers = await db.select().from(users);
      for (const user of allUsers) {
        try {
          await generateInsights(user.id);
        } catch (err) {
          console.error(`[cron] Insights failed for user ${user.id}:`, err);
        }
      }
    } catch (err) {
      console.error("[cron] Insights job failed:", err);
    }
  });

  console.log("[cron] Weekly report: Sundays 6 PM");
  console.log("[cron] Daily insights: Daily 8 AM");
}
