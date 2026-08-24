import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

const environment = process.env.NODE_ENV ?? "development";
for (const path of [
  `.env.${environment}.local`,
  ".env.local",
  `.env.${environment}`,
  ".env",
]) {
  config({ path, override: false });
}

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./lib/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.POSTGRES_URL ?? "",
  },
});
