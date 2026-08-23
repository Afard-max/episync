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
  // No está en el SDD §3.5.1 original: el contrato §3.1 exige devolver "la
  // temporada marcada como activa" cuando se omite season_label en
  // GET /watchlist, pero ningún documento original definía dónde vive esa
  // marca. Decisión explícita del usuario (no heurística): campo propio en
  // User, nullable porque un usuario recién dado de alta aún no tiene
  // ninguna temporada. Se setea vía PATCH /users/me/active-season, y
  // automáticamente la primera vez que el usuario crea contenido en una
  // temporada (ver watchlist.ts) si todavía no tenía ninguna.
  activeSeasonLabel: varchar("active_season_label", { length: 40 }),
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
  // No está en el SDD §3.5.1 original (que solo lista id/user_id/started_at/
  // finished_at/status para ScanRun) — hueco real entre el modelo de datos
  // y el contrato: §4.1 crea cada ScanRun scopeado a una season_label
  // (viene en el body del POST), y §4.3 exige poder filtrar el historial
  // por season_label. Sin esta columna, filtrar requeriría un JOIN contra
  // scan_results -> watchlist_items, que además falla si un ScanRun no
  // produjo ningún resultado (watchlist vacía en esa temporada al momento
  // del escaneo). Se agrega como campo explícito, mismo criterio ya
  // aplicado a users.active_season_label.
  seasonLabel: varchar("season_label", { length: 40 }).notNull(),
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

/**
 * No está en el SDD original (§3.5.1 solo lista las 4 entidades del contrato
 * de negocio) — es una tabla de soporte técnico para el flujo OAuth §2.1/§2.2:
 * el code_verifier de PKCE tiene que sobrevivir entre la llamada a
 * authorize-url y el callback, que llegan en requests HTTP distintos.
 *
 * Se liga al "nonce" embebido en el state firmado (oauth-state.ts), no
 * directamente al userId: así, si el usuario arranca el flujo de login dos
 * veces sin terminar el primero, cada intento tiene su propia fila en vez
 * de que el segundo pise el code_verifier del primero.
 */
export const oauthPendingAuthorizations = pgTable(
  "oauth_pending_authorizations",
  {
    nonce: varchar("nonce", { length: 64 }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    codeVerifier: varchar("code_verifier", { length: 128 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  }
);
