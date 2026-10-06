// =============================================================================
// Migration runner — reads *.sql files from migrations/ and applies them
// in order, tracking applied migrations in a schema_migrations table.
// =============================================================================

import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { getDb } from "./index.js";

export async function runMigrations(): Promise<void> {
  const sql = getDb();
  const migrationsDir = join(__dirname, "../migrations");

  // Ensure tracking table exists
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT        PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  const applied = await sql<{ filename: string }[]>`
    SELECT filename FROM schema_migrations ORDER BY filename
  `;
  const appliedSet = new Set(applied.map((r) => r.filename));

  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (appliedSet.has(file)) {
      console.log(`[db] Skipping already-applied migration: ${file}`);
      continue;
    }

    const filePath = join(migrationsDir, file);
    const sql_text = await readFile(filePath, "utf-8");

    console.log(`[db] Applying migration: ${file}`);
    await sql.unsafe(sql_text);
    await sql`INSERT INTO schema_migrations (filename) VALUES (${file})`;
    console.log(`[db] ✓ Applied: ${file}`);
  }

  console.log("[db] All migrations complete.");
  await sql.end();
}
