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
};

export default scanRunsRoutes;
