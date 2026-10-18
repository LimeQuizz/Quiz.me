import { inject } from "vitest";

process.env.DATABASE_URL = inject("databaseUrl");
process.env.TEST_ADMIN_DATABASE_URL = inject("adminUrl");
