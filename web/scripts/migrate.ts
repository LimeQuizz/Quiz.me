// Applies committed Drizzle migrations. Bundled to dist/migrate.mjs and run
// by the container entrypoint before the server starts. Uses the migration
// role when MIGRATION_DATABASE_URL is set, so the runtime role needs no DDL.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  console.error(JSON.stringify({ level: "error", msg: "DATABASE_URL is not set" }));
  process.exit(1);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder =
  process.env.MIGRATIONS_DIR ?? path.resolve(here, "..", "drizzle");

const client = postgres(url, { max: 1, onnotice: () => {} });
try {
  await migrate(drizzle(client), { migrationsFolder });
  console.log(JSON.stringify({ level: "info", msg: "migrations applied" }));
} catch (err) {
  console.error(
    JSON.stringify({ level: "error", msg: "migration failed", error: String(err) }),
  );
  process.exitCode = 1;
} finally {
  await client.end();
}
