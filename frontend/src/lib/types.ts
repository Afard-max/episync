// Tipos 1:1 con el contrato de API del backend (routes/*.ts). snake_case
// a propósito: son las formas exactas que viajan por la red, no se
// normalizan a camelCase acá para que un diff contra el backend sea
// directo si el contrato cambia.

export type WatchlistStatus = "watching" | "hiatus" | "dropped";

export type ScanRunStatus =
  | "en_progreso"
  | "completado"
  | "completado_con_errores"
  | "fallo_total";

export type ScanResultOutcome = "ok" | "sin_novedad" | "advertencia" | "error";

export type MalConnectionStatus = "conectado" | "expirado" | "no_conectado";

// --- /users ---

export interface CreateUserResponse {
  user_id: string;
  display_name: string;
  api_key: string;
}

export interface UserMe {
  user_id: string;
  display_name: string;
  mal_connection_status: MalConnectionStatus;
  active_season_label: string | null;
  created_at: string;
}

// --- /mal ---

export interface AuthorizeUrlResponse {
  authorize_url: string;
}

export interface DisconnectMalResponse {
  mal_connection_status: MalConnectionStatus;
}

// --- /watchlist ---

export interface WatchlistItem {
  id: string;
  site_title: string;
  mal_anime_id: number;
  current_episode: number;
  status: WatchlistStatus;
  updated_at: string;
}

export interface WatchlistResponse {
  season_label: string | null;
  items: WatchlistItem[];
}

export interface CreateWatchlistItemInput {
  season_label: string;
  site_title: string;
  mal_anime_id: number;
  current_episode: number;
  status: WatchlistStatus;
}

export interface PatchWatchlistItemInput {
  mal_anime_id?: number;
  current_episode?: number;
  status?: WatchlistStatus;
}

export interface BulkWatchlistItemInput {
  site_title: string;
  mal_anime_id: number;
  current_episode: number;
  status: WatchlistStatus;
}

export interface BulkWatchlistResponse {
  season_label: string;
  items_created: number;
  items_updated: number;
  items: WatchlistItem[];
}

// --- /scan-runs ---

export interface CreateScanRunResponse {
  scan_run_id: string;
  status: ScanRunStatus;
}

export interface ScanResult {
  scan_result_id: string;
  watchlist_item_id: string;
  site_title: string;
  mal_anime_id: number;
  episode_current_mal: number;
  episode_found: number | null;
  outcome: ScanResultOutcome;
  detail: string | null;
  confirmed: boolean;
}

export interface ScanRunDetail {
  scan_run_id: string;
  status: ScanRunStatus;
  started_at: string;
  finished_at: string | null;
  results: ScanResult[];
}

export interface ScanRunSummary {
  scan_run_id: string;
  status: ScanRunStatus;
  started_at: string;
  finished_at: string | null;
  total_items: number;
  items_with_novedad: number;
  items_con_advertencia: number;
  items_con_error: number;
}

export interface ListScanRunsResponse {
  scan_runs: ScanRunSummary[];
}

export interface ConfirmedWrite {
  scan_result_id: string;
  site_title: string;
  mal_write_status: "ok";
  num_watched_episodes_set: number;
}

export interface FailedWrite {
  scan_result_id: string;
  site_title: string;
  mal_write_status: "error";
  detail: string;
}

export interface ConfirmResponse {
  confirmed: ConfirmedWrite[];
  failed: FailedWrite[];
}

// §5.2 devuelve un único resultado, con la misma forma que un elemento de
// "confirmed" o "failed" de §5.1.
export type RetryResponse = ConfirmedWrite | FailedWrite;

// --- Errores ---

export interface ApiErrorBody {
  error: string;
  message: string;
  details?: unknown;
}
