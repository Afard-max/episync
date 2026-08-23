import type { FastifyRequest, FastifyReply } from "fastify";
import { eq } from "drizzle-orm";
import { db } from "../modules/storage/db.js";
import { users } from "../modules/storage/schema.js";
import { hashApiKey } from "../modules/storage/api-key.js";

// Fastify no tiene un campo tipado por defecto para adjuntar el usuario
// autenticado al request; se extiende la interfaz para que el resto de las
// rutas tengan autocompletado y chequeo de tipos sobre request.user.
declare module "fastify" {
  interface FastifyRequest {
    user?: {
      id: string;
      displayName: string;
    };
  }
}

/**
 * No usa verifyApiKey() (que compara en tiempo constante contra UN hash ya
 * conocido) porque acá no sabemos de antemano a qué usuario corresponde la
 * key — hay que buscarlo por su hash. hashApiKey() es determinístico
 * (SHA-256 sin salt, por diseño: ver api-key.ts), así que buscar por hash
 * exacto en la DB es seguro y no reintroduce el problema de timing attack
 * que sí existiría comparando strings a mano.
 */
export async function requireApiKey(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const authHeader = request.headers.authorization;
  const providedKey = authHeader?.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : null;

  if (!providedKey) {
    return reply.status(401).send({
      error: "unauthorized",
      message: "Falta el header Authorization: Bearer {api_key}.",
    });
  }

  const providedHash = hashApiKey(providedKey);
  const [foundUser] = await db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(eq(users.apiKeyHash, providedHash))
    .limit(1);

  if (!foundUser) {
    return reply.status(401).send({
      error: "unauthorized",
      message: "API key inválida.",
    });
  }

  request.user = foundUser;
}
