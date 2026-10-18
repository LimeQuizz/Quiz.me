import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const dbImports = {
  patterns: [
    {
      group: ["@/server/db/*", "drizzle-orm", "drizzle-orm/*", "postgres"],
      message:
        "User data must go through the ownership layer in src/server/data (see docs/architecture.md).",
    },
  ],
};

const config = [
  { ignores: [".next/**", "node_modules/**", "dist/**", "coverage/**", "playwright-report/**", "test-results/**", "next-env.d.ts"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "react/no-danger": "error",
      "no-restricted-imports": ["error", dbImports],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // The ownership layer itself, the auth adapter, and tooling may use the DB.
    files: [
      "src/server/data/**",
      "src/server/db/**",
      "src/server/auth/adapter.ts",
      "src/server/auth/config.ts",
      "scripts/**",
      "tests/**",
      "drizzle.config.ts",
    ],
    rules: { "no-restricted-imports": "off" },
  },
];
export default config;
