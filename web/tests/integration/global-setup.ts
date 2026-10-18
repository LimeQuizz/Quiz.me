import { randomBytes } from "node:crypto";
import path from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
    adminUrl: string;
  }
}

let container: StartedPostgreSqlContainer | undefined;

/**
 * Start a throwaway Postgres, create the migration and runtime roles exactly
 * as production does (web/db/roles.sql), migrate as the migration role, and
 * hand the tests a URL for the runtime role.
 */
export default async function setup(project: TestProject) {
  const image = process.env.TEST_POSTGRES_IMAGE ?? "postgres:16-alpine";
  const adminPassword = randomBytes(12).toString("hex");
  const migratorPassword = randomBytes(12).toString("hex");
  const appPassword = randomBytes(12).toString("hex");
  container = await new PostgreSqlContainer(image)
    .withDatabase("quizme")
    .withUsername("postgres")
    .withPassword(adminPassword)
    .withCopyFilesToContainer([
      { source: path.resolve(__dirname, "../../db/roles.sql"), target: "/tmp/roles.sql" },
    ])
    .start();

  const result = await container.exec([
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-v",
    `migrator_password=${migratorPassword}`,
    "-v",
    `app_password=${appPassword}`,
    "-v",
    "db_name=quizme",
    "-f",
    "/tmp/roles.sql",
  ]);
  if (result.exitCode !== 0) throw new Error(`roles.sql failed: ${result.output}`);

  const host = container.getHost();
  const port = container.getPort();
  const url = (user: string, pw: string) => `postgres://${user}:${pw}@${host}:${port}/quizme`;

  const migrator = postgres(url("quizme_migrator", migratorPassword), { max: 1, onnotice: () => {} });
  await migrate(drizzle(migrator), { migrationsFolder: path.resolve(__dirname, "../../drizzle") });
  await migrator.end();

  project.provide("databaseUrl", url("quizme_app", appPassword));
  project.provide("adminUrl", url("postgres", adminPassword));

  return async () => {
    await container?.stop();
  };
}
