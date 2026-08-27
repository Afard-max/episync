import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { requireApiKey } from "./auth-middleware.js";
import { db } from "../modules/storage/db.js";
import {
  scanResults,
  scanRuns,
  watchlistItems,
} from "../modules/storage/schema.js";
import { runScan } from "../modules/extraction/run-scan.js";
import {
  forceRefreshAccessToken,
  getValidAccessToken,
} from "../modules/mal-integration/access-token.js";
import { updateMalListStatus } from "../modules/mal-integration/list-status-client.js";

// SDD §3.4.5, fila "La API de MAL cae o cambia sus reglas": "tras fallos
// consecutivos, [...] se marca error_proveedor sin bloquear el resto de
// las entradas". Se interpreta acá como: tras N fallos CONSECUTIVOS de
// escritura contra MAL dentro de un mismo POST /confirm, se dejan de
// intentar los ítems restantes del lote (se marcan directamente como
// fallidos, sin llamar a MAL) para no insistir contra un proveedor que ya
// mostró estar caído — sin que eso aborte la respuesta HTTP ni deje de
// procesar (y reportar) cada ítem restante. Se resetea a 0 en cualquier
// éxito. No es un circuit breaker persistente entre requests (vive solo
// en memoria de este handler): reintentar con un nuevo POST /confirm más
// tarde vuelve a intentar contra MAL desde cero.
const CIRCUIT_BREAKER_THRESHOLD = 3;

const createScanRunBodySchema = z.object({
  season_label: z.string().min(1),
});

const listScanRunsQuerySchema = z.object({
  season_label: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

const scanRunsRoutes: FastifyPluginAsync = async (app) => {
  // §4.1. Asíncrono por diseño: responde 202 con el ScanRun recién creado
  // en estado en_progreso, y dispara runScan() sin esperarlo (fire and
  // forget) — el frontend hace polling contra §4.2 hasta ver un status
  // terminal, tal como indica el contrato ("procesamiento asíncrono").
  app.post(
    "/scan-runs",
    { preHandler: requireApiKey },
    async (request, reply) => {
      const user = request.user!;
      const parsed = createScanRunBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "validation_error",
          message: "Falta season_label en el body.",
          details: parsed.error.flatten(),
        });
      }
      const { season_label } = parsed.data;

      const [alreadyRunning] = await db
        .select({ id: scanRuns.id })
        .from(scanRuns)
        .where(
          and(eq(scanRuns.userId, user.id), eq(scanRuns.status, "en_progreso"))
        )
        .limit(1);

      if (alreadyRunning) {
        return reply.status(409).send({
          error: "scan_already_running",
          message:
            "Ya existe un ScanRun en_progreso para este usuario; esperá a que termine antes de disparar otro.",
        });
      }

      const [createdRun] = await db
        .insert(scanRuns)
        .values({ userId: user.id, seasonLabel: season_label })
        .returning();

      // No se usa "await" a propósito: la ruta ya respondió 202, el
      // procesamiento real sigue en background. Cualquier error no
      // controlado lo maneja runScan() internamente (marca fallo_total),
      // pero se loguea acá también por si el propio disparo falla antes
      // de entrar al try/catch interno.
      void runScan(
        { scanRunId: createdRun.id, userId: user.id, seasonLabel: season_label },
        { logger: request.log }
      ).catch((err) => {
        request.log.error(
          { err, scanRunId: createdRun.id },
          "Fallo al disparar el procesamiento de un ScanRun."
        );
      });

      return reply
        .status(202)
        .send({ scan_run_id: createdRun.id, status: createdRun.status });
    }
  );

  // §4.2
  app.get(
    "/scan-runs/:scan_run_id",
    { preHandler: requireApiKey },
    async (request, reply) => {
      const user = request.user!;
      const paramsSchema = z.object({ scan_run_id: z.string().uuid() });
      const parsedParams = paramsSchema.safeParse(request.params);
      if (!parsedParams.success) {
        return reply.status(404).send({
          error: "scan_run_not_found",
          message: "El ScanRun no existe.",
        });
      }

      const [run] = await db
        .select()
        .from(scanRuns)
        .where(
          and(
            eq(scanRuns.id, parsedParams.data.scan_run_id),
            eq(scanRuns.userId, user.id)
          )
        )
        .limit(1);

      if (!run) {
        return reply.status(404).send({
          error: "scan_run_not_found",
          message: "El ScanRun no existe.",
        });
      }

      const results = await db
        .select({
          id: scanResults.id,
          watchlistItemId: scanResults.watchlistItemId,
          episodeFound: scanResults.episodeFound,
          episodeCurrentMal: scanResults.episodeCurrentMal,
          outcome: scanResults.outcome,
          detail: scanResults.detail,
          confirmed: scanResults.confirmed,
          siteTitle: watchlistItems.siteTitle,
          malAnimeId: watchlistItems.malAnimeId,
        })
        .from(scanResults)
        .innerJoin(
          watchlistItems,
          eq(scanResults.watchlistItemId, watchlistItems.id)
        )
        .where(eq(scanResults.scanRunId, run.id));

      return reply.send({
        scan_run_id: run.id,
        status: run.status,
        started_at: run.startedAt.toISOString(),
        finished_at: run.finishedAt ? run.finishedAt.toISOString() : null,
        results: results.map((r) => ({
          scan_result_id: r.id,
          watchlist_item_id: r.watchlistItemId,
          site_title: r.siteTitle,
          mal_anime_id: r.malAnimeId,
          episode_current_mal: r.episodeCurrentMal,
          episode_found: r.episodeFound,
          outcome: r.outcome,
          detail: r.detail,
          confirmed: r.confirmed,
        })),
      });
    }
  );

  // §4.3. items_with_novedad se toma como outcome="ok" (progreso real
  // detectado); sin_novedad no se cuenta aparte porque el contrato no le
  // reserva una columna propia en el resumen — puede derivarse como
  // total_items - (ok + advertencia + error) del lado del cliente si hace
  // falta, sin necesidad de una cuarta columna no pedida.
  app.get(
    "/scan-runs",
    { preHandler: requireApiKey },
    async (request, reply) => {
      const user = request.user!;
      const parsedQuery = listScanRunsQuerySchema.safeParse(request.query);
      if (!parsedQuery.success) {
        return reply.status(400).send({
          error: "validation_error",
          message: "Parámetros de consulta inválidos.",
          details: parsedQuery.error.flatten(),
        });
      }

      const conditions = [eq(scanRuns.userId, user.id)];
      if (parsedQuery.data.season_label) {
        conditions.push(eq(scanRuns.seasonLabel, parsedQuery.data.season_label));
      }

      const runs = await db
        .select()
        .from(scanRuns)
        .where(and(...conditions))
        .orderBy(desc(scanRuns.startedAt))
        .limit(parsedQuery.data.limit ?? 20);

      const runIds = runs.map((run) => run.id);
      const countsByRun = new Map<
        string,
        { total: number; ok: number; advertencia: number; error: number }
      >();

      if (runIds.length > 0) {
        const rows = await db
          .select({
            scanRunId: scanResults.scanRunId,
            outcome: scanResults.outcome,
            cnt: sql<number>`count(*)::int`,
          })
          .from(scanResults)
          .where(inArray(scanResults.scanRunId, runIds))
          .groupBy(scanResults.scanRunId, scanResults.outcome);

        for (const row of rows) {
          const entry = countsByRun.get(row.scanRunId) ?? {
            total: 0,
            ok: 0,
            advertencia: 0,
            error: 0,
          };
          entry.total += row.cnt;
          if (row.outcome === "ok") entry.ok += row.cnt;
          if (row.outcome === "advertencia") entry.advertencia += row.cnt;
          if (row.outcome === "error") entry.error += row.cnt;
          countsByRun.set(row.scanRunId, entry);
        }
      }

      return reply.send({
        scan_runs: runs.map((run) => {
          const counts = countsByRun.get(run.id) ?? {
            total: 0,
            ok: 0,
            advertencia: 0,
            error: 0,
          };
          return {
            scan_run_id: run.id,
            status: run.status,
            started_at: run.startedAt.toISOString(),
            finished_at: run.finishedAt ? run.finishedAt.toISOString() : null,
            total_items: counts.total,
            items_with_novedad: counts.ok,
            items_con_advertencia: counts.advertencia,
            items_con_error: counts.error,
          };
        }),
      });
    }
  );

  // §5.1. Escribe en MAL únicamente los scan_result_ids indicados
  // explícitamente. NOTA DE FIDELIDAD AL CONTRATO: "cada resultado, éxito
  // o fallo, marca scan_result.confirmed y scan_result.confirmed_at" está
  // tomado literal del contrato §5.1 tal cual está escrito — incluye
  // marcar confirmed=true incluso en los que terminan en el array
  // "failed". Semánticamente es un poco contraintuitivo (¿"confirmado"
  // pero fallido?), pero no es un hueco de diseño como active_season: acá
  // el contrato SÍ lo especifica sin ambigüedad, así que se sigue tal
  // cual en vez de reinterpretarlo. Si la intención real era otra (ej.
  // confirmed=true solo en éxitos, para que 5.2 pueda reintentar), avisame
  // y lo cambio — es una línea.
  app.post(
    "/scan-runs/:scan_run_id/confirm",
    { preHandler: requireApiKey },
    async (request, reply) => {
      const user = request.user!;

      const paramsSchema = z.object({ scan_run_id: z.string().uuid() });
      const parsedParams = paramsSchema.safeParse(request.params);
      if (!parsedParams.success) {
        return reply.status(404).send({
          error: "scan_run_not_found",
          message: "El ScanRun no existe.",
        });
      }

      const bodySchema = z.object({
        scan_result_ids: z.array(z.string().uuid()).min(1),
      });
      const parsedBody = bodySchema.safeParse(request.body);
      if (!parsedBody.success) {
        return reply.status(400).send({
          error: "validation_error",
          message: "Falta scan_result_ids (array de uuid, mínimo 1) en el body.",
          details: parsedBody.error.flatten(),
        });
      }

      const [run] = await db
        .select()
        .from(scanRuns)
        .where(
          and(
            eq(scanRuns.id, parsedParams.data.scan_run_id),
            eq(scanRuns.userId, user.id)
          )
        )
        .limit(1);

      if (!run) {
        return reply.status(404).send({
          error: "scan_run_not_found",
          message: "El ScanRun no existe.",
        });
      }

      const rows = await db
        .select({
          id: scanResults.id,
          episodeFound: scanResults.episodeFound,
          malAnimeId: watchlistItems.malAnimeId,
          siteTitle: watchlistItems.siteTitle,
        })
        .from(scanResults)
        .innerJoin(
          watchlistItems,
          eq(scanResults.watchlistItemId, watchlistItems.id)
        )
        .where(
          and(
            eq(scanResults.scanRunId, run.id),
            inArray(scanResults.id, parsedBody.data.scan_result_ids)
          )
        );

      if (rows.length !== parsedBody.data.scan_result_ids.length) {
        return reply.status(400).send({
          error: "scan_result_ids_invalidos",
          message:
            "Alguno de los scan_result_ids no pertenece a este scan_run.",
        });
      }

      let accessToken: string;
      try {
        ({ accessToken } = await getValidAccessToken(user.id));
      } catch (err) {
        return reply.status(409).send({
          error: "mal_no_conectado",
          message: err instanceof Error ? err.message : String(err),
        });
      }

      const confirmed: Array<{
        scan_result_id: string;
        site_title: string;
        mal_write_status: "ok";
        num_watched_episodes_set: number;
      }> = [];
      const failed: Array<{
        scan_result_id: string;
        site_title: string;
        mal_write_status: "error";
        detail: string;
      }> = [];

      let consecutiveFailures = 0;
      let reauthAttempted = false; // un solo refresh reactivo por request, no uno por ítem

      for (const row of rows) {
        if (consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
          failed.push({
            scan_result_id: row.id,
            site_title: row.siteTitle,
            mal_write_status: "error",
            detail:
              "error_proveedor: circuit breaker abierto tras fallos consecutivos de MAL, no reintentado",
          });
          await markConfirmed(row.id);
          continue;
        }

        if (row.episodeFound === null) {
          // No hay valor de episodio detectado (ej. scan_result con
          // outcome "error" o "advertencia: mapeo no resuelto"): no hay
          // nada válido para escribir en MAL. No cuenta para el circuit
          // breaker porque no es un fallo de MAL, es un dato local
          // incompleto.
          failed.push({
            scan_result_id: row.id,
            site_title: row.siteTitle,
            mal_write_status: "error",
            detail: "episode_found es null: no hay valor para escribir en MAL.",
          });
          await markConfirmed(row.id);
          continue;
        }

        let result = await updateMalListStatus({
          accessToken,
          malAnimeId: row.malAnimeId,
          numWatchedEpisodes: row.episodeFound,
        });

        if (!result.ok && result.unauthorized && !reauthAttempted) {
          reauthAttempted = true;
          try {
            const refreshed = await forceRefreshAccessToken(user.id);
            accessToken = refreshed.accessToken;
            result = await updateMalListStatus({
              accessToken,
              malAnimeId: row.malAnimeId,
              numWatchedEpisodes: row.episodeFound,
            });
          } catch {
            // El refresh reactivo también falló: se deja el 401 original
            // en "result" y sigue su curso normal más abajo.
          }
        }

        await markConfirmed(row.id);

        if (result.ok) {
          confirmed.push({
            scan_result_id: row.id,
            site_title: row.siteTitle,
            mal_write_status: "ok",
            num_watched_episodes_set: row.episodeFound,
          });
          consecutiveFailures = 0;
        } else {
          failed.push({
            scan_result_id: row.id,
            site_title: row.siteTitle,
            mal_write_status: "error",
            detail: result.detail ?? "fallo desconocido al escribir en MAL.",
          });
          consecutiveFailures += 1;
        }
      }

      return reply.send({ confirmed, failed });
    }
  );

  // §5.2. Reintento individual — reusa exactamente la misma lógica de
  // escritura que un ítem dentro de §5.1 (incluyendo el refresh reactivo
  // ante 401), pero sin el concepto de circuit breaker: no tiene sentido
  // "consecutivo" para un solo ítem.
  app.post(
    "/scan-runs/:scan_run_id/results/:scan_result_id/retry",
    { preHandler: requireApiKey },
    async (request, reply) => {
      const user = request.user!;

      const paramsSchema = z.object({
        scan_run_id: z.string().uuid(),
        scan_result_id: z.string().uuid(),
      });
      const parsedParams = paramsSchema.safeParse(request.params);
      if (!parsedParams.success) {
        return reply.status(404).send({
          error: "scan_run_not_found",
          message: "El ScanRun no existe.",
        });
      }

      const [run] = await db
        .select()
        .from(scanRuns)
        .where(
          and(
            eq(scanRuns.id, parsedParams.data.scan_run_id),
            eq(scanRuns.userId, user.id)
          )
        )
        .limit(1);

      if (!run) {
        return reply.status(404).send({
          error: "scan_run_not_found",
          message: "El ScanRun no existe.",
        });
      }

      const [row] = await db
        .select({
          id: scanResults.id,
          episodeFound: scanResults.episodeFound,
          malAnimeId: watchlistItems.malAnimeId,
          siteTitle: watchlistItems.siteTitle,
        })
        .from(scanResults)
        .innerJoin(
          watchlistItems,
          eq(scanResults.watchlistItemId, watchlistItems.id)
        )
        .where(
          and(
            eq(scanResults.id, parsedParams.data.scan_result_id),
            eq(scanResults.scanRunId, run.id)
          )
        )
        .limit(1);

      if (!row) {
        // Reutiliza el código de error de §5.1 (el contrato no define uno
        // propio para §5.2): mismo caso, "el scan_result no pertenece a
        // ese scan_run".
        return reply.status(400).send({
          error: "scan_result_ids_invalidos",
          message: "El scan_result no pertenece a ese scan_run.",
        });
      }

      if (row.episodeFound === null) {
        await markConfirmed(row.id);
        return reply.send({
          scan_result_id: row.id,
          site_title: row.siteTitle,
          mal_write_status: "error",
          detail: "episode_found es null: no hay valor para escribir en MAL.",
        });
      }

      let accessToken: string;
      try {
        ({ accessToken } = await getValidAccessToken(user.id));
      } catch (err) {
        return reply.status(409).send({
          error: "mal_no_conectado",
          message: err instanceof Error ? err.message : String(err),
        });
      }

      let result = await updateMalListStatus({
        accessToken,
        malAnimeId: row.malAnimeId,
        numWatchedEpisodes: row.episodeFound,
      });

      if (!result.ok && result.unauthorized) {
        try {
          const refreshed = await forceRefreshAccessToken(user.id);
          result = await updateMalListStatus({
            accessToken: refreshed.accessToken,
            malAnimeId: row.malAnimeId,
            numWatchedEpisodes: row.episodeFound,
          });
        } catch {
          // Refresh reactivo también falló: se deja el 401 original.
        }
      }

      await markConfirmed(row.id);

      if (result.ok) {
        return reply.send({
          scan_result_id: row.id,
          site_title: row.siteTitle,
          mal_write_status: "ok",
          num_watched_episodes_set: row.episodeFound,
        });
      }

      return reply.send({
        scan_result_id: row.id,
        site_title: row.siteTitle,
        mal_write_status: "error",
        detail: result.detail ?? "fallo desconocido al escribir en MAL.",
      });
    }
  );
};

async function markConfirmed(scanResultId: string): Promise<void> {
  await db
    .update(scanResults)
    .set({ confirmed: true, confirmedAt: new Date() })
    .where(eq(scanResults.id, scanResultId));
}

export default scanRunsRoutes;
