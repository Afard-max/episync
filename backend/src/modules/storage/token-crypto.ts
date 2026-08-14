import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

/**
 * Cifra los tokens de MAL antes de guardarlos en las columnas bytea
 * (§4.1: nunca texto plano en DB). Formato de almacenamiento por valor:
 * [iv (12 bytes)] + [authTag (16 bytes)] + [ciphertext (resto)]
 * concatenados en un único Buffer, para no necesitar columnas separadas.
 */
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // tamaño recomendado para GCM, no 16 como en CBC
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH_BYTES = 32; // AES-256 = clave de 32 bytes

export class TokenCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenCryptoError";
  }
}

function loadKey(keyHex: string): Buffer {
  const key = Buffer.from(keyHex, "hex");
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new TokenCryptoError(
      `TOKEN_ENCRYPTION_KEY inválida: se esperaban ${KEY_LENGTH_BYTES} bytes (64 caracteres hex), se recibieron ${key.length} bytes. Generar con: openssl rand -hex 32`
    );
  }
  return key;
}

export function encryptToken(plaintext: string, keyHex: string): Buffer {
  const key = loadKey(keyHex);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]);
}

export function decryptToken(stored: Buffer, keyHex: string): string {
  const key = loadKey(keyHex);
  if (stored.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new TokenCryptoError(
      "Buffer cifrado demasiado corto para contener iv + authTag: dato corrupto o de un formato distinto"
    );
  }
  const iv = stored.subarray(0, IV_LENGTH);
  const authTag = stored.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = stored.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  try {
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch {
    throw new TokenCryptoError(
      "Fallo al descifrar: authTag inválido (dato corrupto, alterado, o clave de cifrado incorrecta)"
    );
  }
}
