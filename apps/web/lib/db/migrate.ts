/**
 * Minimal migration runner.
 * Usage: bun run lib/db/migrate.ts
 * Reads ../../supabase/migrations/*.sql in alphabetical order and runs each.
 */
import { Pool } from "pg";
import { readdirSync, readFileSync } from "fs";
import { join, resolve } from "path";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const pool = new Pool({ connectionString: url });
const migrationsDir = resolve(__dirname, "../../../../supabase/migrations");

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

for (const file of files) {
  const sql = readFileSync(join(migrationsDir, file), "utf8");
  console.log(`Running migration: ${file}`);
  try {
    await pool.query(sql);
    console.log(`  OK`);
  } catch (err) {
    console.error(`  FAILED:`, err);
    process.exit(1);
  }
}

await pool.end();
console.log("All migrations complete");
