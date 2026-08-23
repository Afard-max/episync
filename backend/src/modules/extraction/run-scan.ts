import type { FastifyBaseLogger } from "fastify";
import { and, eq } from "drizzle-orm";
import { db } from "../storage/db.js";
import { scanResults, scanRuns, watchlistItems } from "../storage/schema.js";
import { AnimeAv1Provider } from "./animeav1-provider.js";
import { determineOutcome } from "./outcome.js";
import type { ISourceProvider } from "./types.js";

// Cortesía con la fuente externa (SDD §3.2.1 y requisito 4.4: "protegiendo
// también la relación con el sitio fuente"): pausa entre requests
// sucesivos a AnimeAV1 dentro de un mismo ScanRun, además del rate
// limiting a nivel de API que ya aplica @fastify/rate-limit sobre el
// endpoint POST /scan-runs. No viene de un número exigido por ningún
// documento — es un valor conservador propio, ajustable si hace falta.
const REQUEST_COURTESY_DELAY_MS = 300;

/**
 * Procesa un ScanRun ya creado (status "en_progreso" en DB) de punta a
 * punta: lee la watchlist activa de la temporada, extrae el episodio más
 * reciente de cada item vía el ISourceProvider inyectado, persiste un
 * ScanResult por item, y cierra el ScanRun con su status final.
 *
 * Se ejecuta "fire and forget" desde la ruta POST /scan-runs (§4.1 es
 * asíncrono por contrato: responde 202 antes de que esto termine) — por
 * eso nunca lanza hacia afuera, todo error no controlado se loguea acá
 * mismo y el ScanRun queda en "fallo_total" en vez de colgar en
 * "en_progreso" para siempre.
 */
export async function runScan(
  params: {
    scanRunId: string;
    userId: string;
    seasonLabel: string;
  },
  deps: {
    provider?: ISourceProvider;
    logger?: FastifyBaseLogger;
  } = {}
): Promise<void> {
  const provider = deps.provider ?? new AnimeAv1Provider();
  const { scanRunId, userId, seasonLabel } = params;

  try {
    const items = await db
      .select()
      .from(watchlistItems)
      .where(
        and(
          eq(watchlistItems.userId, userId),
          eq(watchlistItems.seasonLabel, seasonLabel),
          eq(watchlistItems.status, "watching")
        )
      );

    let hasError = false;
    let hasOther = false; // ok | sin_novedad | advertencia

    for (const item of items) {
      const extraction = await provider.getLatestEpisode(item.siteTitle);
      const { outcome, detail, episodeFound } = determineOutcome({
        extraction,
        episodeCurrentMal: item.currentEpisode,
      });

      await db.insert(scanResults).values({
        scanRunId,
        watchlistItemId: item.id,
        episodeFound,
        episodeCurrentMal: item.currentEpisode,
        outcome,
        detail,
      });

      if (outcome === "error") {
        hasError = true;
      } else {
        hasOther = true;
      }

      await sleep(REQUEST_COURTESY_DELAY_MS);
    }

    const finalStatus =
      items.length === 0
        ? ("completado" as const) // nada que escanear no es una falla
        : hasError && !hasOther
          ? ("fallo_total" as const)
          : hasError
            ? ("completado_con_errores" as const)
            : ("completado" as const);

    await db
      .update(scanRuns)
      .set({ status: finalStatus, finishedAt: new Date() })
      .where(eq(scanRuns.id, scanRunId));
  } catch (err) {
    deps.logger?.error(
      { err, scanRunId },
      "Fallo no controlado procesando un ScanRun; se marca fallo_total."
    );
    await db
      .update(scanRuns)
      .set({ status: "fallo_total", finishedAt: new Date() })
      .where(eq(scanRuns.id, scanRunId))
      .catch(() => {
        // Si ni siquiera esto se puede persistir (ej. DB caída), no hay
        // nada más que hacer acá: el ScanRun queda huérfano en
        // "en_progreso" y requiere intervención manual. No se reintenta
        // indefinidamente dentro de un proceso fire-and-forget.
      });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
