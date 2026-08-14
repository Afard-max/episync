import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

/**
 * A diferencia de una contraseña elegida por un humano, esta API key tiene
 * 256 bits de entropía propia — por eso alcanza con SHA-256 (rápido) en vez
 * de un hash lento tipo bcrypt/argon2 (pensado para contrarrestar baja
 * entropía de contraseñas humanas, no aplica acá). Mismo criterio que usan
 * GitHub/Stripe para sus tokens de API.
 */
const KEY_PREFIX = "esk_"; // episync key: permite reconocer el tipo de secreto en logs/vaults

export function generateApiKey(): string {
  return KEY_PREFIX + randomBytes(32).toString("base64url");
}

export function hashApiKey(plainKey: string): string {
  return createHash("sha256").update(plainKey).digest("hex");
}

export function verifyApiKey(plainKey: string, storedHash: string): boolean {
  const computedHash = hashApiKey(plainKey);
  const computedBuffer = Buffer.from(computedHash);
  const storedBuffer = Buffer.from(storedHash);
  if (computedBuffer.length !== storedBuffer.length) return false;
  return timingSafeEqual(computedBuffer, storedBuffer); // evita timing attacks
}
