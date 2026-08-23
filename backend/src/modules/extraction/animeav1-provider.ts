import * as cheerio from "cheerio";
import type { ExtractionResult, ISourceProvider } from "./types.js";

const BASE_URL = "https://animeav1.com/media";

// No exigido por el SDD §3.4.5 (los reintentos con backoff y circuit
// breaker ahí solo se le asignan explícitamente a la fila "La API de MAL
// cae", no a la de AnimeAV1) — se agrega igual como robustez adicional
// propia, documentada como tal, no como requisito. No implementa un
// circuit breaker real (eso queda documentado como no-implementado): son
// reintentos por-entrada, acotados, no un mecanismo que se abra entre
// entradas distintas.
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;

/**
 * Verificado por inspección directa de
 * https://animeav1.com/media/yani-neko/8 (22/08/2026, re-verificación
 * puntual de lo ya confirmado en el SDD el 13/08/2026): el HTML sigue
 * siendo SSR y expone la navegación de episodios como una serie de
 * anchors consecutivos con href del tipo /media/{slug}/{n}.
 *
 * LIMITACIÓN DE RIGOR EXPLÍCITA: la verificación se hizo sobre una
 * extracción de contenido ya interpretada (markdown), no sobre el HTML
 * crudo con sus clases/ids reales — no tuve forma de confirmar el
 * selector CSS exacto del contenedor de navegación. Por eso, en vez de
 * depender de una clase/id puntual (no verificado, y potencialmente
 * frágil ante un cambio de framework CSS del sitio), se escanea TODO el
 * documento buscando anchors cuyo href matchee el patrón
 * /media/{slug}/{número} y se toma el número más alto encontrado. Esta
 * estrategia es, si acaso, más tolerante a cambios de maquetación que un
 * selector de clase específica — pero de todos modos debe revalidarse
 * contra tráfico real la primera vez que se corra en serio.
 */
export class AnimeAv1Provider implements ISourceProvider {
  async getLatestEpisode(siteTitle: string): Promise<ExtractionResult> {
    let lastReason = "error desconocido";

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const url = `${BASE_URL}/${encodeURIComponent(siteTitle)}`;
        const response = await fetch(url, {
          headers: {
            "User-Agent": "EpisoSync/0.1 (uso personal, solo lectura de metadatos)",
          },
        });

        if (response.status === 404) {
          // No es un fallo transitorio: el slug no existe en AnimeAV1.
          // No tiene sentido reintentar. SDD §3.4.5: "mapeo no resuelto".
          return {
            ok: false,
            notFound: true,
            reason: `slug no encontrado en AnimeAV1: ${siteTitle}`,
          };
        }

        if (!response.ok) {
          lastReason = `HTTP ${response.status} al pedir ${url}`;
        } else {
          const html = await response.text();
          const latestEpisode = extractLatestEpisodeNumber(html, siteTitle);
          if (latestEpisode !== null) {
            return { ok: true, latestEpisode };
          }
          lastReason =
            "no se encontraron enlaces de navegación de episodios en el HTML de respuesta";
        }
      } catch (err) {
        lastReason = err instanceof Error ? err.message : String(err);
      }

      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
      }
    }

    return {
      ok: false,
      notFound: false,
      reason: `fallo tras ${MAX_ATTEMPTS} intentos: ${lastReason}`,
    };
  }
}

function extractLatestEpisodeNumber(
  html: string,
  siteTitle: string
): number | null {
  const $ = cheerio.load(html);
  const hrefPattern = new RegExp(`/media/${escapeRegExp(siteTitle)}/(\\d+)$`);

  let maxEpisode: number | null = null;
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const match = href.match(hrefPattern);
    if (!match) return;
    const episodeNumber = Number(match[1]);
    if (
      !Number.isNaN(episodeNumber) &&
      (maxEpisode === null || episodeNumber > maxEpisode)
    ) {
      maxEpisode = episodeNumber;
    }
  });

  return maxEpisode;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
