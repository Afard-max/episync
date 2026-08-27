import type {
  ApiErrorBody,
  AuthorizeUrlResponse,
  BulkWatchlistItemInput,
  BulkWatchlistResponse,
  ConfirmResponse,
  CreateScanRunResponse,
  CreateUserResponse,
  CreateWatchlistItemInput,
  DisconnectMalResponse,
  ListScanRunsResponse,
  PatchWatchlistItemInput,
  RetryResponse,
  ScanRunDetail,
  UserMe,
  WatchlistItem,
  WatchlistResponse,
} from "./types";

const BASE_URL = import.meta.env.VITE_API_BASE_URL.replace(/\/$/, "");

/**
 * Error tipado que preserva el status HTTP y el cuerpo de error del
 * backend ({ error, message, details? }), para que la UI pueda
 * distinguir casos puntuales (ej. "duplicate_item", "mal_no_conectado")
 * sin parsear el mensaje en texto libre.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = "ApiError";
    this.status = status;
    this.code = body.error;
    this.details = body.details;
  }
}

interface RequestOptions {
  apiKey?: string;
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (options.apiKey) {
    headers["Authorization"] = `Bearer ${options.apiKey}`;
  }

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    // Fallo de red antes de siquiera llegar al backend (backend caído,
    // CORS, DNS). Se distingue de un ApiError porque acá no hay cuerpo
    // JSON de error que parsear.
    throw new ApiError(0, {
      error: "network_error",
      message:
        "No se pudo contactar al servidor. Verificá tu conexión o que el backend esté activo.",
    });
  }

  // 204 No Content (ej. DELETE /watchlist/items/:id) no tiene cuerpo.
  if (response.status === 204) {
    return undefined as T;
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const body: ApiErrorBody = data ?? {
      error: "unknown_error",
      message: `El servidor respondió ${response.status} sin cuerpo de error legible.`,
    };
    throw new ApiError(response.status, body);
  }

  return data as T;
}

// ---------------------------------------------------------------------
// §1 — Usuarios
// ---------------------------------------------------------------------

export function createUser(input: {
  display_name: string;
  invite_secret: string;
}): Promise<CreateUserResponse> {
  return request<CreateUserResponse>("/api/v1/users", {
    method: "POST",
    body: input,
  });
}

export function getMe(apiKey: string): Promise<UserMe> {
  return request<UserMe>("/api/v1/users/me", { apiKey });
}

export function updateActiveSeason(
  apiKey: string,
  seasonLabel: string
): Promise<{ active_season_label: string }> {
  return request("/api/v1/users/me/active-season", {
    apiKey,
    method: "PATCH",
    body: { season_label: seasonLabel },
  });
}

// ---------------------------------------------------------------------
// §2 — Integración MAL (OAuth)
// ---------------------------------------------------------------------

export function getMalAuthorizeUrl(apiKey: string): Promise<AuthorizeUrlResponse> {
  return request<AuthorizeUrlResponse>("/api/v1/mal/authorize-url", { apiKey });
}

// No hay función para GET /mal/callback: MAL redirige el navegador
// directamente a esa URL, nunca se llama vía fetch desde el frontend.

export function disconnectMal(apiKey: string): Promise<DisconnectMalResponse> {
  return request<DisconnectMalResponse>("/api/v1/mal/disconnect", {
    apiKey,
    method: "POST",
  });
}

// ---------------------------------------------------------------------
// §3 — Watchlist
// ---------------------------------------------------------------------

export function getWatchlist(
  apiKey: string,
  seasonLabel?: string
): Promise<WatchlistResponse> {
  const query = seasonLabel
    ? `?season_label=${encodeURIComponent(seasonLabel)}`
    : "";
  return request<WatchlistResponse>(`/api/v1/watchlist${query}`, { apiKey });
}

export function createWatchlistItem(
  apiKey: string,
  input: CreateWatchlistItemInput
): Promise<WatchlistItem> {
  return request<WatchlistItem>("/api/v1/watchlist/items", {
    apiKey,
    method: "POST",
    body: input,
  });
}

export function updateWatchlistItem(
  apiKey: string,
  itemId: string,
  patch: PatchWatchlistItemInput
): Promise<WatchlistItem> {
  return request<WatchlistItem>(`/api/v1/watchlist/items/${itemId}`, {
    apiKey,
    method: "PATCH",
    body: patch,
  });
}

export function deleteWatchlistItem(
  apiKey: string,
  itemId: string
): Promise<void> {
  return request<void>(`/api/v1/watchlist/items/${itemId}`, {
    apiKey,
    method: "DELETE",
  });
}

export function bulkReplaceWatchlist(
  apiKey: string,
  seasonLabel: string,
  items: BulkWatchlistItemInput[]
): Promise<BulkWatchlistResponse> {
  return request<BulkWatchlistResponse>("/api/v1/watchlist/bulk", {
    apiKey,
    method: "PUT",
    body: { season_label: seasonLabel, items },
  });
}

// ---------------------------------------------------------------------
// §4/§5 — Scan runs y confirmación
// ---------------------------------------------------------------------

export function createScanRun(
  apiKey: string,
  seasonLabel: string
): Promise<CreateScanRunResponse> {
  return request<CreateScanRunResponse>("/api/v1/scan-runs", {
    apiKey,
    method: "POST",
    body: { season_label: seasonLabel },
  });
}

export function getScanRun(
  apiKey: string,
  scanRunId: string
): Promise<ScanRunDetail> {
  return request<ScanRunDetail>(`/api/v1/scan-runs/${scanRunId}`, { apiKey });
}

export function listScanRuns(
  apiKey: string,
  params?: { season_label?: string; limit?: number }
): Promise<ListScanRunsResponse> {
  const query = new URLSearchParams();
  if (params?.season_label) query.set("season_label", params.season_label);
  if (params?.limit) query.set("limit", String(params.limit));
  const qs = query.toString();
  return request<ListScanRunsResponse>(
    `/api/v1/scan-runs${qs ? `?${qs}` : ""}`,
    { apiKey }
  );
}

export function confirmScanResults(
  apiKey: string,
  scanRunId: string,
  scanResultIds: string[]
): Promise<ConfirmResponse> {
  return request<ConfirmResponse>(`/api/v1/scan-runs/${scanRunId}/confirm`, {
    apiKey,
    method: "POST",
    body: { scan_result_ids: scanResultIds },
  });
}

export function retryScanResult(
  apiKey: string,
  scanRunId: string,
  scanResultId: string
): Promise<RetryResponse> {
  return request<RetryResponse>(
    `/api/v1/scan-runs/${scanRunId}/results/${scanResultId}/retry`,
    { apiKey, method: "POST" }
  );
}
