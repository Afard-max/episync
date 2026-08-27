const MAL_API_BASE = "https://api.myanimelist.net/v2";

// SDD §3.4.5, fila "La API de MAL cae o cambia sus reglas": "reintentos
// exponenciales acotados (máx. 3)". Solo se reintentan fallos
// potencialmente transitorios (errores de red, 5xx). Un 4xx que no sea
// 401 (ej. 400 por mal_anime_id inexistente) no es transitorio: no tiene
// sentido reintentarlo, y un 401 se maneja aparte (ver ListStatusResult.
// unauthorized) porque su remedio no es "reintentar", es "refrescar el
// token y reintentar con uno nuevo" — eso lo decide el llamador, no este
// cliente.
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;

export interface ListStatusResult {
  ok: boolean;
  status?: number;
  detail?: string;
  unauthorized?: boolean;
}

/**
 * Escritura real contra MAL, formato verificado por especificación de
 * terceros según nota de rigor final del contrato de API (no por doc
 * oficial completa, ver esa nota): PATCH form-urlencoded con
 * num_watched_episodes, NO JSON.
 *
 * Idempotente por diseño (nota del contrato §5.1): siempre manda el valor
 * absoluto de episode_found, nunca un incremento — reintentar con el
 * mismo valor no cambia el resultado más allá de fijar ese mismo valor.
 */
export async function updateMalListStatus(params: {
  accessToken: string;
  malAnimeId: number;
  numWatchedEpisodes: number;
}): Promise<ListStatusResult> {
  const url = `${MAL_API_BASE}/anime/${params.malAnimeId}/my_list_status`;
  const body = new URLSearchParams({
    num_watched_episodes: String(params.numWatchedEpisodes),
  });

  let lastDetail = "error desconocido";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${params.accessToken}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      });

      if (response.ok) {
        return { ok: true };
      }

      const text = await response.text();

      if (response.status === 401) {
        return {
          ok: false,
          status: 401,
          unauthorized: true,
          detail: `mal_api_error: 401 ${text}`,
        };
      }

      lastDetail = `mal_api_error: ${response.status} ${text}`;

      if (response.status < 500) {
        // 4xx que no sea 401: fallo permanente, no transitorio. No
        // reintentar.
        return { ok: false, status: response.status, detail: lastDetail };
      }
    } catch (err) {
      lastDetail = err instanceof Error ? err.message : String(err);
    }

    if (attempt < MAX_ATTEMPTS) {
      await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
    }
  }

  return { ok: false, detail: lastDetail };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
