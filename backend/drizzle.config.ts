import type { Config } from "drizzle-kit";

export default {
  schema: "./src/models/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL || "postgresql://recap:recap@localhost:5432/recap",
  },
} satisfies Config;
