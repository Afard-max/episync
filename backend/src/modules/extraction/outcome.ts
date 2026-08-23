import type { ExtractionResult } from "./types.js";

export type ScanOutcome = "ok" | "sin_novedad" | "advertencia" | "error";

export interface OutcomeResult {
  outcome: ScanOutcome;
  detail: string | null;
  episodeFound: number | null;
}

/**
 * Traduce un resultado de extracción crudo al outcome del ScanResult,
 * siguiendo literalmente la tabla de contingencias del SDD §3.4.5:
 *
 * - Fallo de extracción por slug inexistente -> advertencia (mapeo no
 *   resuelto), NO error: es una discrepancia de título, no una falla del
 *   sistema, y el SDD es explícito en que nunca se omite silenciosamente.
 * - Cualquier otro fallo de extracción (sitio caído, timeout, HTML con
 *   forma inesperada) -> error.
 * - diferencia == 0 (mismo episodio ya registrado) -> sin_novedad.
 * - diferencia == 1 (progreso normal de un episodio) -> ok.
 * - diferencia > 1 (salto de episodios) -> advertencia, requiere revisión
 *   antes de permitir confirmación individual.
 * - diferencia < 0 (valor regresivo) -> advertencia: valor_regresivo,
 *   puede indicar error de mapeo o reinicio de numeración de la fuente.
 */
export function determineOutcome(params: {
  extraction: ExtractionResult;
  episodeCurrentMal: number;
}): OutcomeResult {
  const { extraction, episodeCurrentMal } = params;

  if (!extraction.ok) {
    if (extraction.notFound) {
      return {
        outcome: "advertencia",
        detail: `mapeo no resuelto: ${extraction.reason}`,
        episodeFound: null,
      };
    }
    return { outcome: "error", detail: extraction.reason, episodeFound: null };
  }

  const diff = extraction.latestEpisode - episodeCurrentMal;

  if (diff === 0) {
    return {
      outcome: "sin_novedad",
      detail: null,
      episodeFound: extraction.latestEpisode,
    };
  }

  if (diff < 0) {
    return {
      outcome: "advertencia",
      detail: `valor_regresivo: episodio detectado (${extraction.latestEpisode}) menor al registrado en MAL (${episodeCurrentMal})`,
      episodeFound: extraction.latestEpisode,
    };
  }

  if (diff > 1) {
    return {
      outcome: "advertencia",
      detail: `salto_de_episodios: de ${episodeCurrentMal} a ${extraction.latestEpisode} (diferencia ${diff})`,
      episodeFound: extraction.latestEpisode,
    };
  }

  return { outcome: "ok", detail: null, episodeFound: extraction.latestEpisode };
}
