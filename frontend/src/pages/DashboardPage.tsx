import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ApiError, createScanRun, getWatchlist, listScanRuns } from "../lib/api";
import type { ScanRunSummary, WatchlistItem } from "../lib/types";
import { Topbar } from "../components/Topbar";
import { Button } from "../components/Button";
import { Badge } from "../components/Badge";
import { FilmstripProgress } from "../components/FilmstripProgress";
import { formatDateTime, watchlistStatusLabel } from "../lib/format";

const statusVariant: Record<WatchlistItem["status"], "mint" | "amber" | "dusk"> = {
  watching: "mint",
  hiatus: "amber",
  dropped: "dusk",
};

export function DashboardPage() {
  const { apiKey } = useAuth();
  const navigate = useNavigate();

  const [seasonLabel, setSeasonLabel] = useState<string | null>(null);
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [lastRun, setLastRun] = useState<ScanRunSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isStartingScan, setIsStartingScan] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    if (!apiKey) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const watchlist = await getWatchlist(apiKey);
      setSeasonLabel(watchlist.season_label);
      setItems(watchlist.items);

      if (watchlist.season_label) {
        const runs = await listScanRuns(apiKey, {
          season_label: watchlist.season_label,
          limit: 1,
        });
        setLastRun(runs.scan_runs[0] ?? null);
      } else {
        setLastRun(null);
      }
    } catch (err) {
      setLoadError(
        err instanceof ApiError
          ? err.message
          : "No se pudo cargar tu watchlist. Intentá de nuevo."
      );
    } finally {
      setIsLoading(false);
    }
  }, [apiKey]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  async function handleStartScan() {
    if (!apiKey || !seasonLabel) return;
    setIsStartingScan(true);
    setScanError(null);
    try {
      const result = await createScanRun(apiKey, seasonLabel);
      navigate(`/escaneo/${result.scan_run_id}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === "scan_already_running") {
        // Ya hay un ScanRun en_progreso para este usuario (§4.1): en vez
        // de solo mostrar el error, se busca cuál es y se navega ahí
        // directo — es la misma corrida a la que apuntaría el usuario si
        // reintentara, así que no tiene sentido bloquearlo con un cartel.
        try {
          const runs = await listScanRuns(apiKey, { season_label: seasonLabel, limit: 1 });
          const running = runs.scan_runs[0];
          if (running && running.status === "en_progreso") {
            navigate(`/escaneo/${running.scan_run_id}`);
            return;
          }
        } catch {
          // si esto también falla, se cae al mensaje de error genérico
        }
      }
      setScanError(
        err instanceof ApiError
          ? err.message
          : "No se pudo iniciar el escaneo. Intentá de nuevo."
      );
    } finally {
      setIsStartingScan(false);
    }
  }

  return (
    <div className="min-h-dvh ambient-glow">
      <Topbar />
      <main className="p-6 max-w-3xl mx-auto flex flex-col gap-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold">
              {seasonLabel ?? "Sin temporada activa"}
            </h1>
            {lastRun && (
              <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
                Último escaneo: {formatDateTime(lastRun.started_at)} ·{" "}
                {lastRun.status === "en_progreso" ? "en curso" : lastRun.status.replace(/_/g, " ")}
              </p>
            )}
          </div>

          <Button
            onClick={handleStartScan}
            isLoading={isStartingScan}
            disabled={!seasonLabel || items.length === 0}
          >
            Iniciar escaneo
          </Button>
        </div>

        {scanError && (
          <div
            className="glass-panel-sm rounded-xl px-4 py-3 text-sm"
            style={{ color: "var(--color-coral)" }}
            role="alert"
          >
            {scanError}
          </div>
        )}

        {isLoading ? (
          <div className="glass-panel rounded-3xl p-8 text-center" style={{ color: "var(--text-secondary)" }}>
            Cargando watchlist…
          </div>
        ) : loadError ? (
          <div className="glass-panel rounded-3xl p-8" style={{ color: "var(--color-coral)" }}>
            {loadError}
          </div>
        ) : !seasonLabel || items.length === 0 ? (
          <div className="glass-panel rounded-3xl p-8 text-center">
            <p style={{ color: "var(--text-secondary)" }}>
              Todavía no tenés títulos en tu watchlist
              {seasonLabel ? ` para ${seasonLabel}` : ""}. Configurala para
              poder escanear novedades.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {items.map((item) => (
              <li
                key={item.id}
                className="glass-panel rounded-2xl p-4 flex items-center justify-between gap-4 flex-wrap"
              >
                <div className="min-w-0">
                  <p className="font-medium truncate">{item.site_title}</p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
                    Actualizado {formatDateTime(item.updated_at)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant={statusVariant[item.status]}>
                    {watchlistStatusLabel[item.status]}
                  </Badge>
                  <FilmstripProgress episode={item.current_episode} size="sm" />
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
