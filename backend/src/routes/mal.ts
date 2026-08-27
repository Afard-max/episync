import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireApiKey } from "./auth-middleware.js";
import { generatePkcePair } from "../modules/mal-integration/pkce.js";
import {
  signOauthState,
  verifyOauthState,
  STATE_TTL_MS,
} from "../modules/mal-integration/oauth-state.js";
import { buildAuthorizeUrl } from "../modules/mal-integration/authorize-url.js";
import {
  exchangeCodeForToken,
  MalTokenError,
} from "../modules/mal-integration/token-client.js";
import { encryptToken } from "../modules/storage/token-crypto.js";
import { db } from "../modules/storage/db.js";
import { users, oauthPendingAuthorizations } from "../modules/storage/schema.js";

const callbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

// El contrato §2.2 no distingue esto, pero un usuario real llega acá
// navegando (no via fetch): un JSON crudo de error lo deja varado fuera
// de la SPA sin ninguna forma de volver. Si FRONTEND_URL está configurada
// (necesaria igual para el caso de éxito), cualquier fallo del callback
// también redirige de vuelta a la app con el motivo en query params, en
// vez de mostrar el JSON. Si FRONTEND_URL no está configurada ni siquiera
// para esto, no hay adónde redirigir, así que cae al JSON como antes.
function callbackError(
  reply: FastifyReply,
  frontendUrl: string | undefined,
  status: number,
  code: string,
  message: string
) {
  if (frontendUrl) {
    return reply.redirect(
      `${frontendUrl}/configuracion/cuenta?mal_status=error&mal_error=${encodeURIComponent(code)}`
    );
  }
  return reply.status(status).send({ error: code, message });
}

const malRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/mal/authorize-url",
    { preHandler: requireApiKey },
    async (request, reply) => {
      const user = request.user!;

      const clientId = process.env.MAL_CLIENT_ID;
      const redirectUri = process.env.MAL_REDIRECT_URI;
      const jwtSecret = process.env.APP_JWT_SECRET;

      if (!clientId || !redirectUri || !jwtSecret) {
        request.log.error(
          "Falta config de OAuth: MAL_CLIENT_ID, MAL_REDIRECT_URI o APP_JWT_SECRET."
        );
        return reply.status(500).send({
          error: "server_misconfigured",
          message:
            "El servidor no puede iniciar el flujo de OAuth en este momento.",
        });
      }

      const { codeVerifier, codeChallenge } = generatePkcePair();
      const { state, nonce } = signOauthState(user.id, jwtSecret);

      await db.insert(oauthPendingAuthorizations).values({
        nonce,
        userId: user.id,
        codeVerifier,
        expiresAt: new Date(Date.now() + STATE_TTL_MS),
      });

      const authorizeUrl = buildAuthorizeUrl({
        clientId,
        redirectUri,
        codeChallenge,
        state,
      });

      return reply.send({ authorize_url: authorizeUrl });
    }
  );

  // SIN AUTH (§2.2 del contrato): no llega header Authorization propio de
  // la app, MAL redirige acá directo desde el navegador del usuario. La
  // identidad se recupera únicamente del "state" firmado.
  app.get("/mal/callback", async (request, reply) => {
    // Se lee una sola vez al principio: se necesita en TODAS las ramas de
    // error de acá en adelante, no solo en la de éxito.
    const frontendUrl = process.env.FRONTEND_URL;

    const parsedQuery = callbackQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return callbackError(
        reply,
        frontendUrl,
        400,
        "invalid_state",
        "Faltan los parámetros code o state en el callback."
      );
    }
    const { code, state } = parsedQuery.data;

    const jwtSecret = process.env.APP_JWT_SECRET;
    if (!jwtSecret) {
      request.log.error(
        "Falta APP_JWT_SECRET para verificar el state del callback."
      );
      return callbackError(
        reply,
        frontendUrl,
        500,
        "server_misconfigured",
        "El servidor no puede procesar el callback en este momento."
      );
    }

    const verified = verifyOauthState(state, jwtSecret);
    if (!verified) {
      return callbackError(
        reply,
        frontendUrl,
        400,
        "invalid_state",
        "El state no corresponde a una solicitud válida o expiró."
      );
    }

    const [pending] = await db
      .select()
      .from(oauthPendingAuthorizations)
      .where(eq(oauthPendingAuthorizations.nonce, verified.nonce))
      .limit(1);

    if (
      !pending ||
      pending.userId !== verified.userId ||
      pending.expiresAt < new Date()
    ) {
      return callbackError(
        reply,
        frontendUrl,
        400,
        "invalid_state",
        "La solicitud de autorización no existe o expiró."
      );
    }

    const clientId = process.env.MAL_CLIENT_ID;
    const clientSecret = process.env.MAL_CLIENT_SECRET; // opcional, PKCE público
    const redirectUri = process.env.MAL_REDIRECT_URI;
    const encryptionKey = process.env.TOKEN_ENCRYPTION_KEY;

    if (!clientId || !redirectUri || !encryptionKey || !frontendUrl) {
      request.log.error(
        "Falta config para completar el callback (MAL_CLIENT_ID, MAL_REDIRECT_URI, TOKEN_ENCRYPTION_KEY o FRONTEND_URL)."
      );
      return callbackError(
        reply,
        frontendUrl,
        500,
        "server_misconfigured",
        "El servidor no puede completar la conexión con MAL en este momento."
      );
    }

    let tokenResponse;
    try {
      tokenResponse = await exchangeCodeForToken({
        clientId,
        clientSecret,
        code,
        codeVerifier: pending.codeVerifier,
        redirectUri,
      });
    } catch (err) {
      const detail = err instanceof MalTokenError ? err.message : String(err);
      request.log.error({ detail }, "Fallo al intercambiar code por token con MAL.");
      return callbackError(
        reply,
        frontendUrl,
        502,
        "mal_token_exchange_failed",
        "MAL rechazó el intercambio de código."
      );
    }

    const accessTokenEnc = encryptToken(
      tokenResponse.access_token,
      encryptionKey
    );
    const refreshTokenEnc = encryptToken(
      tokenResponse.refresh_token,
      encryptionKey
    );
    const expiresAt = new Date(
      Date.now() + tokenResponse.expires_in * 1000
    );

    await db
      .update(users)
      .set({
        malAccessTokenEnc: accessTokenEnc,
        malRefreshTokenEnc: refreshTokenEnc,
        malTokenExpiresAt: expiresAt,
      })
      .where(eq(users.id, verified.userId));

    await db
      .delete(oauthPendingAuthorizations)
      .where(eq(oauthPendingAuthorizations.nonce, verified.nonce));

    return reply.redirect(
      `${frontendUrl}/configuracion/cuenta?mal_status=conectado`
    );
  });

  // §2.3 del contrato: revocación LOCAL únicamente. No llama a MAL porque
  // su API pública no expone un endpoint de revocación garantizado (ver
  // nota de rigor final del contrato). El contrato no lista errores para
  // este endpoint -> operación idempotente: desconectar a un usuario que
  // ya estaba desconectado no es un error, solo confirma el estado final.
  app.post(
    "/mal/disconnect",
    { preHandler: requireApiKey },
    async (request, reply) => {
      const user = request.user!;

      await db
        .update(users)
        .set({
          malAccessTokenEnc: null,
          malRefreshTokenEnc: null,
          malTokenExpiresAt: null,
        })
        .where(eq(users.id, user.id));

      return reply.send({ mal_connection_status: "no_conectado" });
    }
  );
};

export default malRoutes;
