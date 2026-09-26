import cron from "node-cron";
import { eq } from "drizzle-orm";
import { db } from "../services/db.js";
import { users } from "../models/schema.js";
import { generateWeeklyReport, generateInsights } from "../services/insights.js";
import { buildDigest, localDayHour } from "../services/digest.js";
import { sendEmail, isEmailConfigured } from "../services/email.js";
import { sendDueReminders } from "../services/reminders.js";
import { syncAllCalendars, sendPrepBriefs } from "../services/calendar.js";

/**
 * Send weekly summaries that are due. Each user picks a weekday and hour in their own
 * timezone; a missed hour (server down, provider error) is caught up later that day,
 * and a user never gets more than one summary in 6 days.
 */
export async function sendDueDigests(now = new Date()) {
  if (!isEmailConfigured()) return;
  const subscribers = await db.select().from(users).where(eq(users.digestEnabled, true));
  for (const user of subscribers) {
    const to = user.digestEmail || user.email;
    if (!to) continue;
    const { day, hour } = localDayHour(now, user.timezone || "UTC");
    if (day !== user.digestDay || hour < user.digestHour) continue;
    if (user.lastDigestSentAt && now.getTime() - user.lastDigestSentAt.getTime() < 6 * 86400000) continue;
    try {
      const digest = await buildDigest(user.id, now);
      await sendEmail({ to, subject: digest.subject, html: digest.html, text: digest.text });
      await db.update(users).set({ lastDigestSentAt: now }).where(eq(users.id, user.id));
      console.log(`[digest] sent weekly summary to user ${user.id}`);
    } catch (err) {
      console.error(`[digest] failed for user ${user.id} (will retry next hour):`, err);
    }
  }
}

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

  // Weekly email summaries: check hourly, each user on their own schedule
  cron.schedule("7 * * * *", () => {
    sendDueDigests().catch((err) => console.error("[cron] Digest job failed:", err));
  });

  // Commitment reminders: hourly check, each user at their own hour
  cron.schedule("12 * * * *", () => {
    sendDueReminders().catch((err) => console.error("[cron] Reminder job failed:", err));
  });

  // Calendars: refresh every 15 minutes; prep briefs ~30 min before meetings
  cron.schedule("*/15 * * * *", () => {
    syncAllCalendars().catch((err) => console.error("[cron] Calendar sync failed:", err));
  });
  cron.schedule("*/5 * * * *", () => {
    sendPrepBriefs().catch((err) => console.error("[cron] Prep briefs failed:", err));
  });

  console.log("[cron] Weekly email summaries: hourly check");
  console.log("[cron] Weekly report: Sundays 6 PM");
  console.log("[cron] Daily insights: Daily 8 AM");
}
