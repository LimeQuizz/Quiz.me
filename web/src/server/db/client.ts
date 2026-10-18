import "server-only";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

let instance: Database | undefined;

export function createDatabase(url: string, max = 10): Database {
  const client = postgres(url, { max, onnotice: () => {} });
  return drizzle(client, { schema });
}

/** Process-wide database handle for the running server. */
export function getDb(): Database {
  if (!instance) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    instance = createDatabase(url);
  }
  return instance;
}
