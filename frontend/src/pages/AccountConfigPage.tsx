import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ApiError, disconnectMal, getMalAuthorizeUrl } from "../lib/api";
import { Topbar } from "../components/Topbar";
import { Button } from "../components/Button";
import { Badge } from "../components/Badge";
import { formatDateTime } from "../lib/format";
import type { MalConnectionStatus } from "../lib/types";

const statusLabel: Record<MalConnectionStatus, string> = {
  conectado: "Conectado",
  expirado: "Expirado — hace falta reconectar",
  no_conectado: "No conectado",
};

const statusVariant: Record<MalConnectionStatus, "mint" | "amber" | "dusk"> = {
  conectado: "mint",
  expirado: "amber",
  no_conectado: "dusk",
};

const malCallbackErrorLabel: Record<string, string> = {
  invalid_state: "La solicitud de conexión con MAL expiró o no es válida. Probá conectar de nuevo.",
  server_misconfigured: "El servidor no tiene bien configuradas las credenciales de MAL.",
  mal_token_exchange_failed: "MyAnimeList rechazó la conexión. Probá de nuevo.",
};

export function AccountConfigPage() {
  const { apiKey, user, refreshUser } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [justConnected, setJustConnected] = useState(false);

  // Vuelta del callback OAuth (§2.2): el backend redirige acá tanto en
  // éxito (?mal_status=conectado) como en error (?mal_status=error con
  // ?mal_error=<code>) desde que se corrigió el callback para no dejar al
  // usuario varado en un JSON crudo fuera de la SPA.
  useEffect(() => {
    const status = searchParams.get("mal_status");
    if (status === "conectado") {
      setJustConnected(true);
      void refreshUser();
      setSearchParams({}, { replace: true });
    } else if (status === "error") {
      const code = searchParams.get("mal_error") ?? "";
      setActionError(
        malCallbackErrorLabel[code] ?? "No se pudo completar la conexión con MyAnimeList."
      );
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleConnect() {
    if (!apiKey) return;
    setIsConnecting(true);
    setActionError(null);
    try {
      const { authorize_url } = await getMalAuthorizeUrl(apiKey);
      // Redirect de página completa a propósito: el flujo OAuth de MAL
      // necesita navegar fuera de la SPA, no es algo que se resuelva
      // con fetch.
      window.location.href = authorize_url;
    } catch (err) {
      setIsConnecting(false);
      setActionError(
        err instanceof ApiError
          ? err.code === "server_misconfigured"
            ? "El servidor no tiene configuradas las credenciales de MAL (MAL_CLIENT_ID / MAL_REDIRECT_URI / APP_JWT_SECRET)."
            : err.message
          : "No se pudo iniciar la conexión con MAL."
      );
    }
  }

  async function handleDisconnect() {
    if (!apiKey) return;
    if (!window.confirm("¿Desconectar tu cuenta de MyAnimeList?")) return;
    setIsDisconnecting(true);
    setActionError(null);
    try {
      await disconnectMal(apiKey);
      await refreshUser();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : "No se pudo desconectar."
      );
    } finally {
      setIsDisconnecting(false);
    }
  }

  if (!user) return null;

  return (
    <div className="min-h-dvh ambient-glow">
      <Topbar />
      <main className="p-6 max-w-2xl mx-auto flex flex-col gap-6">
        <h1 className="text-2xl font-semibold">Configuración de cuenta</h1>

        {justConnected && (
          <div
            className="glass-panel-sm rounded-xl px-4 py-3 text-sm"
            style={{ color: "var(--color-mint)" }}
          >
            ✓ Tu cuenta de MyAnimeList quedó conectada.
          </div>
        )}

        {actionError && (
          <div
            className="glass-panel-sm rounded-xl px-4 py-3 text-sm"
            style={{ color: "var(--color-coral)" }}
            role="alert"
          >
            {actionError}
          </div>
        )}

        <section className="glass-panel rounded-2xl p-5 flex flex-col gap-3">
          <h2 className="font-medium">Perfil</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt style={{ color: "var(--text-secondary)" }}>Nombre</dt>
            <dd>{user.display_name}</dd>
            <dt style={{ color: "var(--text-secondary)" }}>Temporada activa</dt>
            <dd>{user.active_season_label ?? "— sin definir —"}</dd>
            <dt style={{ color: "var(--text-secondary)" }}>Cuenta creada</dt>
            <dd>{formatDateTime(user.created_at)}</dd>
          </dl>
        </section>

        <section className="glass-panel rounded-2xl p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <h2 className="font-medium">MyAnimeList</h2>
            <Badge variant={statusVariant[user.mal_connection_status]}>
              {statusLabel[user.mal_connection_status]}
            </Badge>
          </div>

          <div className="flex gap-3 flex-wrap">
            {user.mal_connection_status !== "conectado" && (
              <Button onClick={handleConnect} isLoading={isConnecting}>
                {user.mal_connection_status === "expirado"
                  ? "Reconectar con MyAnimeList"
                  : "Conectar con MyAnimeList"}
              </Button>
            )}
            {user.mal_connection_status !== "no_conectado" && (
              <Button
                variant="danger"
                onClick={handleDisconnect}
                isLoading={isDisconnecting}
              >
                Desconectar
              </Button>
            )}
          </div>
        </section>

        <section className="glass-panel rounded-2xl p-5">
          <h2 className="font-medium mb-2">API key</h2>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            Por seguridad, el backend solo guarda un hash de tu API key —
            nunca se vuelve a mostrar después de la creación de la cuenta. Si
            la perdiste, no hay forma de recuperarla; haría falta crear un
            usuario nuevo.
          </p>
        </section>
      </main>
    </div>
  );
}
