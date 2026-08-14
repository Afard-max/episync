import { randomBytes } from "node:crypto";

/**
 * MyAnimeList solo soporta code_challenge_method="plain" (confirmado en
 * https://myanimelist.net/apiconfig/references/authorization, 13/08/2026).
 * Con "plain", el code_challenge es idéntico al code_verifier, sin SHA-256.
 * Esto es específico de MAL — la mayoría de los proveedores OAuth2/PKCE
 * exigen S256 y rechazan "plain" por ser menos seguro. No portar esta
 * función a otro proveedor sin revisar su soporte de code_challenge_method.
 */
export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
}

const MIN_LENGTH = 43;
const MAX_LENGTH = 128;

export function generatePkcePair(): PkcePair {
  // 64 bytes en base64url ≈ 86 caracteres, dentro del rango 43-128 que exige MAL.
  const codeVerifier = randomBytes(64)
    .toString("base64url")
    .slice(0, MAX_LENGTH);

  if (codeVerifier.length < MIN_LENGTH) {
    // No debería ocurrir con 64 bytes de entrada, pero se deja la validación
    // explícita en vez de asumir silenciosamente que el tamaño siempre alcanza.
    throw new Error(
      `code_verifier generado (${codeVerifier.length} chars) por debajo del mínimo de MAL (${MIN_LENGTH})`
    );
  }

  return {
    codeVerifier,
    codeChallenge: codeVerifier, // method=plain: challenge === verifier
  };
}
