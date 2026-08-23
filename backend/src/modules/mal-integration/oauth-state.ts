import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

/**
 * El parámetro "state" del flujo OAuth (§2.1/§2.2 del contrato) debe viajar
 * firmado porque en /mal/callback (§2.2) no hay header Authorization propio
 * de la app — la identidad del usuario se recupera únicamente de este state.
 * Sin firma, cualquiera podría fabricar un state con un user_id ajeno.
 */
interface StatePayload {
  userId: string;
  nonce: string;
  issuedAt: number;
}

export const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutos: tiempo razonable para que el usuario complete el login en MAL

function sign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export interface SignedOauthState {
  state: string;
  nonce: string;
}

export function signOauthState(userId: string, secret: string): SignedOauthState {
  const nonce = randomUUID();
  const payload: StatePayload = {
    userId,
    nonce,
    issuedAt: Date.now(),
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url"
  );
  const signature = sign(encodedPayload, secret);
  return { state: `${encodedPayload}.${signature}`, nonce };
}

export interface VerifiedOauthState {
  userId: string;
  nonce: string;
}

/**
 * Devuelve {userId, nonce} si el state es válido (firma correcta y no
 * vencido), o null si fue alterado, corresponde a otro secret, o expiró.
 * El nonce se necesita en el callback (§2.2) para encontrar la fila de
 * oauth_pending_authorizations que guarda el code_verifier de este intento
 * puntual — no alcanza con el userId porque puede haber varios intentos
 * en paralelo (ver comentario en schema.ts sobre oauthPendingAuthorizations).
 * Nunca lanza: un state inválido es un caso esperado (ataque, doble-click,
 * link viejo), no una excepción del sistema.
 */
export function verifyOauthState(
  state: string,
  secret: string
): VerifiedOauthState | null {
  const parts = state.split(".");
  if (parts.length !== 2) return null;
  const [encodedPayload, signature] = parts;

  const expectedSignature = sign(encodedPayload, secret);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  let payload: StatePayload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString());
  } catch {
    return null;
  }

  if (Date.now() - payload.issuedAt > STATE_TTL_MS) return null;

  return { userId: payload.userId, nonce: payload.nonce };
}
