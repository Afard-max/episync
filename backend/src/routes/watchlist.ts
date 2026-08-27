import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { requireApiKey } from "./auth-middleware.js";
import { db } from "../modules/storage/db.js";
import { users, watchlistItems } from "../modules/storage/schema.js";

const watchlistStatusSchema = z.enum(["watching", "hiatus", "dropped"]);

function serializeItem(item: typeof watchlistItems.$inferSelect) {
  return {
    id: item.id,
    site_title: item.siteTitle,
    mal_anime_id: item.malAnimeId,
    current_episode: item.currentEpisode,
    status: item.status,
    updated_at: item.updatedAt.toISOString(),
  };
}

// El código de Postgres para violación de constraint UNIQUE (usado para
// mapear al 409 duplicate_item del contrato §3.2, respaldado por
// uniqueUserSeasonTitle en schema.ts).
const PG_UNIQUE_VIOLATION = "23505";

const createItemBodySchema = z.object({
  season_label: z.string().min(1),
  site_title: z.string().min(1),
  mal_anime_id: z.number().int().positive(),
  current_episode: z.number().int().min(0),
  status: watchlistStatusSchema,
});

const patchItemBodySchema = z
  .object({
    mal_anime_id: z.number().int().positive().optional(),
    current_episode: z.number().int().min(0).optional(),
    status: watchlistStatusSchema.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "Debe enviarse al menos un campo para actualizar.",
  });

const bulkBodySchema = z.object({
  season_label: z.string().min(1),
  items: z.array(
    z.object({
      site_title: z.string().min(1),
      mal_anime_id: z.number().int().positive(),
      current_episode: z.number().int().min(0),
      status: watchlistStatusSchema,
    })
  ),
});

const watchlistRoutes: FastifyPluginAsync = async (app) => {
  // §3.1. "Temporada activa" = users.active_season_label (campo explícito,
  // ver nota de diseño en schema.ts). Ya no es una heurística: si el
  // usuario nunca la seteó (vía PATCH /users/me/active-season, o
  // implícitamente al crear su primer item/bulk, ver más abajo), no hay
  // temporada que inferir y se devuelve season_label: null con items vacío.
  app.get(
    "/watchlist",
    { preHandler: requireApiKey },
    async (request, reply) => {
      const user = request.user!;
      const querySchema = z.object({ season_label: z.string().min(1).optional() });
      const parsedQuery = querySchema.safeParse(request.query);
      if (!parsedQuery.success) {
        return reply.status(400).send({
          error: "validation_error",
          message: "Parámetro season_label inválido.",
          details: parsedQuery.error.flatten(),
        });
      }

      let seasonLabel = parsedQuery.data.season_label ?? null;

      if (!seasonLabel) {
        const [fullUser] = await db
          .select({ activeSeasonLabel: users.activeSeasonLabel })
          .from(users)
          .where(eq(users.id, user.id))
          .limit(1);
        seasonLabel = fullUser?.activeSeasonLabel ?? null;
      }

      if (!seasonLabel) {
        return reply.send({ season_label: null, items: [] });
      }

      const items = await db
        .select()
        .from(watchlistItems)
        .where(
          and(
            eq(watchlistItems.userId, user.id),
            eq(watchlistItems.seasonLabel, seasonLabel)
          )
        );

      return reply.send({
        season_label: seasonLabel,
        items: items.map(serializeItem),
      });
    }
  );

  // §3.2
  app.post(
    "/watchlist/items",
    { preHandler: requireApiKey },
    async (request, reply) => {
      const user = request.user!;
      const parsed = createItemBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "validation_error",
          message: "Datos de la entrada de watchlist inválidos.",
          details: parsed.error.flatten(),
        });
      }
      const body = parsed.data;

      try {
        const [created] = await db
          .insert(watchlistItems)
          .values({
            userId: user.id,
            seasonLabel: body.season_label,
            siteTitle: body.site_title,
            malAnimeId: body.mal_anime_id,
            currentEpisode: body.current_episode,
            status: body.status,
          })
          .returning();

        await setActiveSeasonIfUnset(user.id, body.season_label);

        return reply.status(201).send(serializeItem(created));
      } catch (err) {
        if (isUniqueViolation(err)) {
          return reply.status(409).send({
            error: "duplicate_item",
            message:
              "Ya existe un item con ese site_title en esa season_label para este usuario.",
          });
        }
        throw err;
      }
    }
  );

  // §3.3. Alcance de la actualización restringido a userId = dueño
  // autenticado (no está explícito en el contrato, pero se deriva
  // directamente del requisito de aislamiento multi-tenant del SDD §3.2.2
  // punto 3: un usuario no debe poder editar ni descubrir por status code
  // items de otro usuario). Fila no encontrada bajo ese scope -> 404
  // item_not_found, igual si el id no existe o si pertenece a otro usuario.
  app.patch(
    "/watchlist/items/:item_id",
    { preHandler: requireApiKey },
    async (request, reply) => {
      const user = request.user!;
      const paramsSchema = z.object({ item_id: z.string().uuid() });
      const parsedParams = paramsSchema.safeParse(request.params);
      if (!parsedParams.success) {
        return reply.status(404).send({
          error: "item_not_found",
          message: "El item de watchlist no existe.",
        });
      }

      const parsedBody = patchItemBodySchema.safeParse(request.body);
      if (!parsedBody.success) {
        return reply.status(400).send({
          error: "validation_error",
          message: "Datos de actualización inválidos.",
          details: parsedBody.error.flatten(),
        });
      }

      const patch: Partial<typeof watchlistItems.$inferInsert> = {
        updatedAt: new Date(),
      };
      if (parsedBody.data.mal_anime_id !== undefined) {
        patch.malAnimeId = parsedBody.data.mal_anime_id;
      }
      if (parsedBody.data.current_episode !== undefined) {
        patch.currentEpisode = parsedBody.data.current_episode;
      }
      if (parsedBody.data.status !== undefined) {
        patch.status = parsedBody.data.status;
      }

      const [updated] = await db
        .update(watchlistItems)
        .set(patch)
        .where(
          and(
            eq(watchlistItems.id, parsedParams.data.item_id),
            eq(watchlistItems.userId, user.id)
          )
        )
        .returning();

      if (!updated) {
        return reply.status(404).send({
          error: "item_not_found",
          message: "El item de watchlist no existe.",
        });
      }

      return reply.send(serializeItem(updated));
    }
  );

  // §3.4. El contrato solo documenta la respuesta 204 y no lista errores,
  // pero se aplica el mismo scope de propiedad que en PATCH (§3.3) por el
  // mismo argumento de aislamiento multi-tenant: intentar borrar un item
  // ajeno se trata como "no existe" para este usuario, no se ejecuta el
  // delete ni se filtra su existencia real.
  app.delete(
    "/watchlist/items/:item_id",
    { preHandler: requireApiKey },
    async (request, reply) => {
      const user = request.user!;
      const paramsSchema = z.object({ item_id: z.string().uuid() });
      const parsedParams = paramsSchema.safeParse(request.params);
      if (!parsedParams.success) {
        return reply.status(404).send({
          error: "item_not_found",
          message: "El item de watchlist no existe.",
        });
      }

      const deleted = await db
        .delete(watchlistItems)
        .where(
          and(
            eq(watchlistItems.id, parsedParams.data.item_id),
            eq(watchlistItems.userId, user.id)
          )
        )
        .returning({ id: watchlistItems.id });

      if (deleted.length === 0) {
        return reply.status(404).send({
          error: "item_not_found",
          message: "El item de watchlist no existe.",
        });
      }

      return reply.status(204).send();
    }
  );

  // §3.5. Reemplazo acotado a season_label: se calcula el diff contra el
  // estado actual de esa temporada (por site_title, que es único por
  // usuario+temporada) dentro de una transacción, para que "creados",
  // "actualizados" y el borrado de los items ausentes de la nueva lista
  // sean atómicos entre sí. Nunca toca otras season_label del usuario.
  app.put(
    "/watchlist/bulk",
    { preHandler: requireApiKey },
    async (request, reply) => {
      const user = request.user!;
      const parsed = bulkBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "validation_error",
          message: "Datos de reemplazo masivo inválidos.",
          details: parsed.error.flatten(),
        });
      }
      const { season_label, items } = parsed.data;

      const seenTitles = new Set<string>();
      for (const item of items) {
        if (seenTitles.has(item.site_title)) {
          return reply.status(400).send({
            error: "validation_error",
            message: `site_title duplicado dentro del mismo payload: ${item.site_title}`,
          });
        }
        seenTitles.add(item.site_title);
      }

      const result = await db.transaction(async (tx) => {
        const existing = await tx
          .select()
          .from(watchlistItems)
          .where(
            and(
              eq(watchlistItems.userId, user.id),
              eq(watchlistItems.seasonLabel, season_label)
            )
          );
        const existingByTitle = new Map(
          existing.map((row) => [row.siteTitle, row])
        );

        let itemsCreated = 0;
        let itemsUpdated = 0;
        const finalItems: (typeof watchlistItems.$inferSelect)[] = [];

        for (const item of items) {
          const prev = existingByTitle.get(item.site_title);
          if (prev) {
            const [updatedRow] = await tx
              .update(watchlistItems)
              .set({
                malAnimeId: item.mal_anime_id,
                currentEpisode: item.current_episode,
                status: item.status,
                updatedAt: new Date(),
              })
              .where(eq(watchlistItems.id, prev.id))
              .returning();
            itemsUpdated += 1;
            finalItems.push(updatedRow);
          } else {
            const [createdRow] = await tx
              .insert(watchlistItems)
              .values({
                userId: user.id,
                seasonLabel: season_label,
                siteTitle: item.site_title,
                malAnimeId: item.mal_anime_id,
                currentEpisode: item.current_episode,
                status: item.status,
              })
              .returning();
            itemsCreated += 1;
            finalItems.push(createdRow);
          }
        }

        const incomingTitles = new Set(items.map((item) => item.site_title));
        const toDeleteIds = existing
          .filter((row) => !incomingTitles.has(row.siteTitle))
          .map((row) => row.id);
        if (toDeleteIds.length > 0) {
          await tx
            .delete(watchlistItems)
            .where(inArray(watchlistItems.id, toDeleteIds));
        }

        return { itemsCreated, itemsUpdated, finalItems };
      });

      await setActiveSeasonIfUnset(user.id, season_label);

      return reply.send({
        season_label,
        items_created: result.itemsCreated,
        items_updated: result.itemsUpdated,
        items: result.finalItems.map(serializeItem),
      });
    }
  );
};

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === PG_UNIQUE_VIOLATION
  );
}

// Decisión propia (no pedida explícitamente): si el usuario todavía no
// tiene ninguna active_season_label seteada, la primera temporada con la
// que interactúa vía escritura (crear un item o hacer un bulk) se adopta
// automáticamente como activa. Evita que un usuario nuevo tenga que llamar
// a PATCH /users/me/active-season antes de poder usar GET /watchlist sin
// query param. La condición isNull() hace que esto nunca pise una
// temporada activa ya elegida explícitamente por el usuario.
async function setActiveSeasonIfUnset(
  userId: string,
  seasonLabel: string
): Promise<void> {
  await db
    .update(users)
    .set({ activeSeasonLabel: seasonLabel })
    .where(and(eq(users.id, userId), isNull(users.activeSeasonLabel)));
}

export default watchlistRoutes;
