const MAL_AUTHORIZE_ENDPOINT = "https://myanimelist.net/v1/oauth2/authorize";

export interface BuildAuthorizeUrlParams {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
}

/**
 * redirect_uri se envía siempre de forma explícita, aunque la doc oficial
 * la marque como opcional: es opcional solo si el usuario registró una única
 * URI en el panel de MAL, y en este proyecto hay dos (local + Render), así
 * que omitirla dejaría a MAL sin poder resolver cuál usar.
 */
export function buildAuthorizeUrl(params: BuildAuthorizeUrlParams): string {
  const url = new URL(MAL_AUTHORIZE_ENDPOINT);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "plain");
  url.searchParams.set("state", params.state);
  return url.toString();
}
