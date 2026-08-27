import type { FastifyPluginAsync } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../modules/storage/db.js";
import { users } from "../modules/storage/schema.js";
import { generateApiKey, hashApiKey } from "../modules/storage/api-key.js";
import { requireApiKey } from "./auth-middleware.js";

const createUserBodySchema = z.object({
  display_name: z.string().min(1).max(80),
  invite_secret: z.string().min(1),
});

/**
 * Solo se persiste el vencimiento del access token (~1h), no el del refresh
 * token (~1 mes según doc de MAL) — no hay una columna separada para eso.
 * Aproximación: si el access token venció hace más de lo que dura un
 * refresh token, asumimos que el refresh también venció ("expirado"). Es
 * una heurística, no un dato exacto; se puede refinar más adelante si al
 * implementar el refresh real (§5.1) MAL devuelve una señal más precisa
 * (ej. un intento de refresh que falla con invalid_grant).
 */
const REFRESH_TOKEN_APPROX_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

function computeMalConnectionStatus(
  hasTokens: boolean,
  accessTokenExpiresAt: Date | null
): "conectado" | "expirado" | "no_conectado" {
  if (!hasTokens) return "no_conectado";
  if (!accessTokenExpiresAt) return "conectado";
  const msSinceExpiry = Date.now() - accessTokenExpiresAt.getTime();
  return msSinceExpiry > REFRESH_TOKEN_APPROX_LIFETIME_MS
    ? "expirado"
    : "conectado";
}

const usersRoutes: FastifyPluginAsync = async (app) => {
  app.post("/users", async (request, reply) => {
    const parsed = createUserBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "validation_error",
        message: "Datos de alta de usuario inválidos.",
        details: parsed.error.flatten(),
      });
    }
    const { display_name, invite_secret } = parsed.data;

    const expectedSecret = process.env.INVITE_SECRET;
    if (!expectedSecret) {
      request.log.error("INVITE_SECRET no está configurado en el entorno.");
      return reply.status(500).send({
        error: "server_misconfigured",
        message: "El servidor no puede procesar altas en este momento.",
      });
    }

    const providedBuffer = Buffer.from(invite_secret);
    const expectedBuffer = Buffer.from(expectedSecret);
    const secretsMatch =
      providedBuffer.length === expectedBuffer.length &&
      timingSafeEqual(providedBuffer, expectedBuffer);

    if (!secretsMatch) {
      return reply.status(403).send({
        error: "invalid_invite_secret",
        message: "Clave de invitación incorrecta.",
      });
    }

    const apiKey = generateApiKey();
    const apiKeyHash = hashApiKey(apiKey);

    const [createdUser] = await db
      .insert(users)
      .values({ displayName: display_name, apiKeyHash })
      .returning();

    return reply.status(201).send({
      user_id: createdUser.id,
      display_name: createdUser.displayName,
      api_key: apiKey,
    });
  });

  app.get(
    "/users/me",
    { preHandler: requireApiKey },
    async (request, reply) => {
      const authenticatedUser = request.user!;

      const [fullUser] = await db
        .select()
        .from(users)
        .where(eq(users.id, authenticatedUser.id))
        .limit(1);

      if (!fullUser) {
        return reply.status(404).send({
          error: "user_not_found",
          message: "El usuario autenticado ya no existe.",
        });
      }

      return reply.send({
        user_id: fullUser.id,
        display_name: fullUser.displayName,
        mal_connection_status: computeMalConnectionStatus(
          fullUser.malAccessTokenEnc !== null,
          fullUser.malTokenExpiresAt
        ),
        active_season_label: fullUser.activeSeasonLabel,
        created_at: fullUser.createdAt.toISOString(),
      });
    }
  );

  // No está en el contrato original (§1 solo documenta POST /users y
  // GET /users/me) — endpoint nuevo, necesario porque §3.1 depende de que
  // exista una forma de setear la temporada activa (ver nota en
  // schema.ts sobre activeSeasonLabel). Decisión propia documentada, no
  // silenciosa: se agrega bajo /users/me por coherencia con el resto de
  // la gestión de la cuenta autenticada, no bajo /watchlist porque es un
  // dato de configuración del usuario, no del watchlist en sí.
  app.patch(
    "/users/me/active-season",
    { preHandler: requireApiKey },
    async (request, reply) => {
      const user = request.user!;
      const bodySchema = z.object({ season_label: z.string().min(1).max(40) });
      const parsed = bodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "validation_error",
          message: "season_label inválida.",
          details: parsed.error.flatten(),
        });
      }

      await db
        .update(users)
        .set({ activeSeasonLabel: parsed.data.season_label })
        .where(eq(users.id, user.id));

      return reply.send({ active_season_label: parsed.data.season_label });
    }
  );
};

export default usersRoutes;
