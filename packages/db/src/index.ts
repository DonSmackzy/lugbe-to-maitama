// =============================================================================
// @ltm/db — DB client factory and migration runner
// Uses `postgres` (postgres.js) — lightweight, no ORM overhead.
// =============================================================================

import postgres from "postgres";

let _sql: ReturnType<typeof postgres> | null = null;

/**
 * Returns a singleton postgres connection.
 * DATABASE_URL must be set in the environment.
 */
export function getDb(): ReturnType<typeof postgres> {
  if (_sql) return _sql;

  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL environment variable is not set");

  _sql = postgres(url, {
    max: 20,
    idle_timeout: 30,
    connect_timeout: 10,
    // Transform: snake_case DB columns → camelCase JS objects
    transform: postgres.camel,
    onnotice: () => {}, // suppress NOTICE logs in tests
  });

  return _sql;
}

export type Sql = ReturnType<typeof getDb>;
