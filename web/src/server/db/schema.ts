import { sql } from "drizzle-orm";
import {
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

const createdAt = () =>
  timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();

// ---------------------------------------------------------------------------
// Auth.js adapter tables
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 200 }),
  // Deliberately NOT unique: accounts are never linked by email.
  email: varchar("email", { length: 320 }),
  emailVerified: timestamp("email_verified", { withTimezone: true, mode: "date" }),
  image: text("image"),
  createdAt: createdAt(),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 32 }).notNull(),
    provider: varchar("provider", { length: 64 }).notNull(),
    providerAccountId: varchar("provider_account_id", { length: 255 }).notNull(),
    // Token columns exist for adapter compatibility; the adapter wrapper in
    // src/server/auth/adapter.ts never writes them.
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: varchar("token_type", { length: 64 }),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [
    primaryKey({ columns: [t.provider, t.providerAccountId] }),
    index("accounts_user_id_idx").on(t.userId),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    sessionToken: varchar("session_token", { length: 255 }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expires: timestamp("expires", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: varchar("identifier", { length: 320 }).notNull(),
    token: varchar("token", { length: 255 }).notNull(),
    expires: timestamp("expires", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

// ---------------------------------------------------------------------------
// Application tables. Every row is reachable only through a user_id.
// ---------------------------------------------------------------------------

export const CARD_TYPES = ["basic", "multiple_choice", "fill_blank"] as const;
export type CardType = (typeof CARD_TYPES)[number];

export const decks = pgTable(
  "decks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 200 }).notNull(),
    description: varchar("description", { length: 2000 }),
    sourceFilename: varchar("source_filename", { length: 255 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("decks_user_id_updated_at_idx").on(t.userId, t.updatedAt.desc())],
);

export const cards = pgTable(
  "cards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deckId: uuid("deck_id")
      .notNull()
      .references(() => decks.id, { onDelete: "cascade" }),
    front: text("front").notNull(),
    back: text("back").notNull(),
    cardType: varchar("card_type", { length: 32 }).$type<CardType>().notNull().default("basic"),
    options: jsonb("options").$type<string[] | null>(),
    confidence: real("confidence"),
    sourceRef: varchar("source_ref", { length: 50 }),
    position: integer("position").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("cards_deck_id_position_idx").on(t.deckId, t.position),
    check("cards_front_len", sql`char_length(${t.front}) between 1 and 2000`),
    check("cards_back_len", sql`char_length(${t.back}) between 1 and 2000`),
    check(
      "cards_card_type",
      sql`${t.cardType} in ('basic', 'multiple_choice', 'fill_blank')`,
    ),
  ],
);

export const cardProgress = pgTable(
  "card_progress",
  {
    cardId: uuid("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    due: timestamp("due", { withTimezone: true, mode: "date" }).notNull(),
    stability: doublePrecision("stability").notNull().default(0),
    difficulty: doublePrecision("difficulty").notNull().default(0),
    reps: integer("reps").notNull().default(0),
    lapses: integer("lapses").notNull().default(0),
    state: smallint("state").notNull().default(0),
    lastReview: timestamp("last_review", { withTimezone: true, mode: "date" }),
    scheduledDays: integer("scheduled_days").notNull().default(0),
    learningSteps: integer("learning_steps").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.cardId, t.userId] }),
    index("card_progress_user_id_due_idx").on(t.userId, t.due),
  ],
);

export const reviewLog = pgTable(
  "review_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cardId: uuid("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    rating: smallint("rating").notNull(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    elapsedDays: integer("elapsed_days").notNull().default(0),
    scheduledDays: integer("scheduled_days").notNull().default(0),
  },
  (t) => [
    index("review_log_user_id_reviewed_at_idx").on(t.userId, t.reviewedAt),
    check("review_log_rating", sql`${t.rating} between 1 and 4`),
  ],
);

export const UPLOAD_STATUSES = ["accepted", "rejected", "failed"] as const;
export type UploadStatus = (typeof UPLOAD_STATUSES)[number];

export const uploadEvents = pgTable(
  "upload_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    bytes: integer("bytes").notNull().default(0),
    status: varchar("status", { length: 16 }).$type<UploadStatus>().notNull(),
  },
  (t) => [index("upload_events_user_id_created_at_idx").on(t.userId, t.createdAt)],
);
