import { eq } from "drizzle-orm";
import { db } from "../storage/db.js";
import { users } from "../storage/schema.js";
import { decryptToken, encryptToken } from "../storage/token-crypto.js";
import { MalTokenError, refreshAccessToken } from "./token-client.js";

export class MalNotConnectedError extends Error {
  constructor(
    message = "El usuario no tiene una sesión OAuth válida con MAL."
  ) {
    super(message);
    this.name = "MalNotConnectedError";
  }
}

// Margen de seguridad antes del vencimiento persistido: evita refrescar
// "justo a tiempo" y toparse con que el token vence en el viaje de red
// hacia MAL. No viene de un número exigido por ningún documento, es un
// valor conservador propio.
const EXPIRY_SAFETY_MARGIN_MS = 60 * 1000;

interface EnvConfig {
  encryptionKey: string;
  clientId: string;
  clientSecret?: string;
}

function loadEnvConfig(): EnvConfig {
  const encryptionKey = process.env.TOKEN_ENCRYPTION_KEY;
  const clientId = process.env.MAL_CLIENT_ID;
  if (!encryptionKey || !clientId) {
    throw new Error(
      "Falta configuración requerida: TOKEN_ENCRYPTION_KEY o MAL_CLIENT_ID."
    );
  }
  return { encryptionKey, clientId, clientSecret: process.env.MAL_CLIENT_SECRET };
}

/**
 * §5.1 nota de diseño: "si el access_token está vencido, el backend debe
 * intentar refrescar con el refresh_token antes de fallar la operación
 * (transparente al usuario)". Esta función es ese paso: refresca SOLO si
 * hace falta (chequeo proactivo contra malTokenExpiresAt), y devuelve
 * directamente el token vigente si no.
 *
 * Lanza MalNotConnectedError si el usuario nunca conectó MAL, o si el
 * refresh_token también dejó de ser válido — en ambos casos el llamador
 * debe responder 409 mal_no_conectado a nivel de toda la operación, según
 * el contrato §5.1: no tiene sentido intentar escribir nada sin sesión.
 */
export async function getValidAccessToken(
  userId: string
): Promise<{ accessToken: string }> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user || !user.malAccessTokenEnc || !user.malRefreshTokenEnc) {
    throw new MalNotConnectedError();
  }

  const config = loadEnvConfig();

  const isExpired =
    !user.malTokenExpiresAt ||
    user.malTokenExpiresAt.getTime() - EXPIRY_SAFETY_MARGIN_MS <= Date.now();

  if (!isExpired) {
    return {
      accessToken: decryptToken(user.malAccessTokenEnc, config.encryptionKey),
    };
  }

  return refreshAndPersist(userId, user.malRefreshTokenEnc, config);
}

/**
 * Refresh reactivo: se usa cuando MAL devuelve 401 a pesar de que
 * malTokenExpiresAt decía que el token todavía era válido (desfasaje de
 * reloj, revocación manual del lado de MAL, etc.). A diferencia de
 * getValidAccessToken(), este SIEMPRE llama a MAL, sin chequear expiry
 * primero.
 */
export async function forceRefreshAccessToken(
  userId: string
): Promise<{ accessToken: string }> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user || !user.malRefreshTokenEnc) {
    throw new MalNotConnectedError();
  }

  const config = loadEnvConfig();
  return refreshAndPersist(userId, user.malRefreshTokenEnc, config);
}

async function refreshAndPersist(
  userId: string,
  refreshTokenEnc: Buffer,
  config: EnvConfig
): Promise<{ accessToken: string }> {
  const refreshToken = decryptToken(refreshTokenEnc, config.encryptionKey);

  let tokenResponse;
  try {
    tokenResponse = await refreshAccessToken({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      refreshToken,
    });
  } catch (err) {
    throw new MalNotConnectedError(
      `Refresh de token falló, se trata como sesión inválida: ${
        err instanceof MalTokenError ? err.message : String(err)
      }`
    );
  }

  const accessTokenEnc = encryptToken(
    tokenResponse.access_token,
    config.encryptionKey
  );
  const refreshTokenEncNew = encryptToken(
    tokenResponse.refresh_token,
    config.encryptionKey
  );
  const expiresAt = new Date(Date.now() + tokenResponse.expires_in * 1000);

  await db
    .update(users)
    .set({
      malAccessTokenEnc: accessTokenEnc,
      malRefreshTokenEnc: refreshTokenEncNew,
      malTokenExpiresAt: expiresAt,
    })
    .where(eq(users.id, userId));

  return { accessToken: tokenResponse.access_token };
}
