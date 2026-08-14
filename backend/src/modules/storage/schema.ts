import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  integer,
  boolean,
  timestamp,
  customType,
  unique,
} from "drizzle-orm/pg-core";

// bytea nativo de Postgres para los tokens cifrados (§4.1: nunca texto plano).
// drizzle-orm no trae un helper "bytea" de fábrica, se define como custom type.
const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

// --- Enums (§3.5.1) ---
export const watchlistStatusEnum = pgEnum("watchlist_status", [
  "watching",
  "hiatus",
  "dropped",
]);

// Nota de transparencia: el SDD §3.5.1 solo lista completado/completado_con_errores/
// fallo_total para ScanRun.status, pero el contrato de API §4.2 exige "en_progreso"
// como estado inicial mientras el escaneo corre. Es una omisión entre ambos
// documentos, no una decisión mía silenciosa — la agrego porque sin ella un
// ScanRun no tendría estado válido entre su creación y su finalización.
export const scanRunStatusEnum = pgEnum("scan_run_status", [
  "en_progreso",
  "completado",
  "completado_con_errores",
  "fallo_total",
]);

export const scanResultOutcomeEnum = pgEnum("scan_result_outcome", [
  "ok",
  "sin_novedad",
  "advertencia",
  "error",
]);

// --- Tablas ---
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  displayName: varchar("display_name", { length: 80 }).notNull(),
  apiKeyHash: varchar("api_key_hash", { length: 255 }).notNull().unique(),
  malAccessTokenEnc: bytea("mal_access_token_enc"),
  malRefreshTokenEnc: bytea("mal_refresh_token_enc"),
  malTokenExpiresAt: timestamp("mal_token_expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const watchlistItems = pgTable(
  "watchlist_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    seasonLabel: varchar("season_label", { length: 40 }).notNull(),
    siteTitle: varchar("site_title", { length: 200 }).notNull(),
    malAnimeId: integer("mal_anime_id").notNull(),
    currentEpisode: integer("current_episode").notNull().default(0),
    status: watchlistStatusEnum("status").notNull().default("watching"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    // Respalda el 409 duplicate_item del contrato §3.2: mismo site_title
    // no puede repetirse para el mismo usuario en la misma temporada.
    uniqueUserSeasonTitle: unique().on(
      table.userId,
      table.seasonLabel,
      table.siteTitle
    ),
  })
);

export const scanRuns = pgTable("scan_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  status: scanRunStatusEnum("status").notNull().default("en_progreso"),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const scanResults = pgTable("scan_results", {
  id: uuid("id").primaryKey().defaultRandom(),
  scanRunId: uuid("scan_run_id")
    .notNull()
    .references(() => scanRuns.id, { onDelete: "cascade" }),
  watchlistItemId: uuid("watchlist_item_id")
    .notNull()
    .references(() => watchlistItems.id, { onDelete: "cascade" }),
  episodeFound: integer("episode_found"),
  episodeCurrentMal: integer("episode_current_mal").notNull(),
  outcome: scanResultOutcomeEnum("outcome").notNull(),
  detail: varchar("detail", { length: 500 }),
  confirmed: boolean("confirmed").notNull().default(false),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
});
