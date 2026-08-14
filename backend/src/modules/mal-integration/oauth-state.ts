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

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutos: tiempo razonable para que el usuario complete el login en MAL

function sign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function signOauthState(userId: string, secret: string): string {
  const payload: StatePayload = {
    userId,
    nonce: randomUUID(),
    issuedAt: Date.now(),
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url"
  );
  const signature = sign(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

/**
 * Devuelve el userId si el state es válido (firma correcta y no vencido),
 * o null si fue alterado, corresponde a otro secret, o expiró.
 * Nunca lanza: un state inválido es un caso esperado (ataque, doble-click,
 * link viejo), no una excepción del sistema.
 */
export function verifyOauthState(
  state: string,
  secret: string
): string | null {
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
    return null; // comparación en tiempo constante: evita timing attacks
  }

  let payload: StatePayload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString());
  } catch {
    return null;
  }

  if (Date.now() - payload.issuedAt > STATE_TTL_MS) return null;

  return payload.userId;
}
