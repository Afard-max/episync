import { z } from "zod";

const MAL_TOKEN_ENDPOINT = "https://myanimelist.net/v1/oauth2/token";

const tokenResponseSchema = z.object({
  token_type: z.string(),
  expires_in: z.number(),
  access_token: z.string(),
  refresh_token: z.string(),
});

export type MalTokenResponse = z.infer<typeof tokenResponseSchema>;

export class MalTokenError extends Error {
  constructor(
    public status: number,
    public body: string
  ) {
    super(`MAL token endpoint respondió ${status}: ${body}`);
    this.name = "MalTokenError";
  }
}

interface ExchangeCodeParams {
  clientId: string;
  clientSecret?: string; // opcional: MAL permite flujo público solo con PKCE
  code: string;
  codeVerifier: string;
  redirectUri: string;
}

export async function exchangeCodeForToken(
  params: ExchangeCodeParams
): Promise<MalTokenResponse> {
  const body = new URLSearchParams({
    client_id: params.clientId,
    grant_type: "authorization_code",
    code: params.code,
    code_verifier: params.codeVerifier,
    redirect_uri: params.redirectUri,
  });
  if (params.clientSecret) body.set("client_secret", params.clientSecret);
  return callTokenEndpoint(body);
}

interface RefreshTokenParams {
  clientId: string;
  clientSecret?: string;
  refreshToken: string;
}

export async function refreshAccessToken(
  params: RefreshTokenParams
): Promise<MalTokenResponse> {
  const body = new URLSearchParams({
    client_id: params.clientId,
    grant_type: "refresh_token",
    refresh_token: params.refreshToken,
  });
  if (params.clientSecret) body.set("client_secret", params.clientSecret);
  return callTokenEndpoint(body);
}

async function callTokenEndpoint(
  body: URLSearchParams
): Promise<MalTokenResponse> {
  const response = await fetch(MAL_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    // Cuerpo crudo en el error, no reintentado ni transformado acá: quien
    // llama (§2.2 callback, §5.1 confirm con refresh transparente) decide
    // qué hacer — mapear a 502 mal_token_exchange_failed, reintentar, etc.
    const errorText = await response.text();
    throw new MalTokenError(response.status, errorText);
  }

  const json = await response.json();
  const parsed = tokenResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(
      `Respuesta de token de MAL con forma inesperada: ${parsed.error.message}`
    );
  }
  return parsed.data;
}
