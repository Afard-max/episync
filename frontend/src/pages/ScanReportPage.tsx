import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import {
  ApiError,
  confirmScanResults,
  getScanRun,
  retryScanResult,
} from "../lib/api";
import type { ScanRunDetail, ScanRunStatus } from "../lib/types";
import { Topbar } from "../components/Topbar";
import { Button } from "../components/Button";
import { Badge } from "../components/Badge";
import { ScanResultRow } from "../components/ScanResultRow";
import { formatDateTime } from "../lib/format";

const POLL_INTERVAL_MS = 2500;
const TERMINAL_STATUSES: ScanRunStatus[] = [
  "completado",
  "completado_con_errores",
  "fallo_total",
];

// Estado de escritura conocido en ESTA sesión (viene de /confirm o
// /retry). No persiste entre recargas: ver la nota en ScanResultRow.tsx
// sobre por qué el contrato no permite reconstruirlo desde GET solo.
interface WriteInfo {
  status: "ok" | "error";
  detail?: string;
}

export function ScanReportPage() {
  const { scanRunId } = useParams<{ scanRunId: string }>();
  const { apiKey } = useAuth();

  const [run, setRun] = useState<ScanRunDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [writeInfo, setWriteInfo] = useState<Record<string, WriteInfo>>({});
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [showSinNovedad, setShowSinNovedad] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchRun = useCallback(async () => {
    if (!apiKey || !scanRunId) return;
    try {
      const detail = await getScanRun(apiKey, scanRunId);
      setRun(detail);
      setLoadError(null);
      if (TERMINAL_STATUSES.includes(detail.status) && pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "No se pudo cargar el escaneo."
      );
    }
  }, [apiKey, scanRunId]);

  useEffect(() => {
    void fetchRun();
    pollRef.current = setInterval(() => void fetchRun(), POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanRunId, apiKey]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleConfirmSelected() {
    if (!apiKey || !scanRunId || selected.size === 0) return;
    setIsConfirming(true);
    setConfirmError(null);
    const ids = Array.from(selected);
    try {
      const result = await confirmScanResults(apiKey, scanRunId, ids);
      const nextWriteInfo: Record<string, WriteInfo> = { ...writeInfo };
      for (const c of result.confirmed) {
        nextWriteInfo[c.scan_result_id] = { status: "ok" };
      }
      for (const f of result.failed) {
        nextWriteInfo[f.scan_result_id] = { status: "error", detail: f.detail };
      }
      setWriteInfo(nextWriteInfo);
      setSelected(new Set());
      // El backend ya marcó confirmed=true en la DB para todos estos ids
      // (éxito o fallo) — se refleja localmente sin esperar el próximo
      // poll, para que la fila cambie de estado al instante.
      setRun((prev) =>
        prev
          ? {
              ...prev,
              results: prev.results.map((r) =>
                ids.includes(r.scan_result_id) ? { ...r, confirmed: true } : r
              ),
            }
          : prev
      );
    } catch (err) {
      setConfirmError(
        err instanceof ApiError
          ? err.code === "mal_no_conectado"
            ? "Tu cuenta de MyAnimeList no está conectada. Conectala desde Configuración de cuenta antes de confirmar."
            : err.message
          : "No se pudo confirmar. Intentá de nuevo."
      );
    } finally {
      setIsConfirming(false);
    }
  }

  async function handleRetry(scanResultId: string) {
    if (!apiKey || !scanRunId) return;
    setRetryingId(scanResultId);
    setConfirmError(null);
    try {
      const result = await retryScanResult(apiKey, scanRunId, scanResultId);
      setWriteInfo((prev) => ({
        ...prev,
        [scanResultId]:
          result.mal_write_status === "ok"
            ? { status: "ok" }
            : { status: "error", detail: result.detail },
      }));
    } catch (err) {
      setConfirmError(
        err instanceof ApiError
          ? err.code === "mal_no_conectado"
            ? "Tu cuenta de MyAnimeList no está conectada. Conectala desde Configuración de cuenta antes de reintentar."
            : err.message
          : "No se pudo reintentar. Intentá de nuevo."
      );
    } finally {
      setRetryingId(null);
    }
  }

  if (loadError && !run) {
    return (
      <div className="min-h-dvh ambient-glow">
        <Topbar />
        <main className="p-6 max-w-3xl mx-auto">
          <div className="glass-panel rounded-3xl p-8" style={{ color: "var(--color-coral)" }}>
            {loadError}
          </div>
        </main>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="min-h-dvh ambient-glow">
        <Topbar />
        <main className="p-6 max-w-3xl mx-auto">
          <div
            className="glass-panel rounded-3xl p-8 text-center"
            style={{ color: "var(--text-secondary)" }}
          >
            Cargando escaneo…
          </div>
        </main>
      </div>
    );
  }

  const visibleResults = run.results.filter(
    (r) => showSinNovedad || r.outcome !== "sin_novedad"
  );
  const hiddenCount = run.results.length - visibleResults.length;
  const selectableCount = run.results.filter(
    (r) => !r.confirmed && r.episode_found !== null
  ).length;

  return (
    <div className="min-h-dvh ambient-glow">
      <Topbar />
      <main className="p-6 max-w-3xl mx-auto flex flex-col gap-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Reporte de escaneo</h1>
            <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
              Iniciado {formatDateTime(run.started_at)}
              {run.finished_at ? ` · finalizado ${formatDateTime(run.finished_at)}` : ""}
            </p>
          </div>
          <RunStatusBadge status={run.status} />
        </div>

        {run.status === "en_progreso" && (
          <div
            className="glass-panel-sm rounded-xl px-4 py-3 text-sm flex items-center gap-2"
            style={{ color: "var(--text-secondary)" }}
          >
            <span
              className="h-3 w-3 rounded-full border-2 border-current border-t-transparent animate-spin"
              aria-hidden
            />
            Escaneando tu watchlist contra AnimeAV1… esto se actualiza solo.
          </div>
        )}

        {run.status === "fallo_total" && (
          <div
            className="glass-panel-sm rounded-xl px-4 py-3 text-sm"
            style={{ color: "var(--color-coral)" }}
          >
            El escaneo falló por completo antes de poder procesar ítems. Volvé
            al dashboard e iniciá uno nuevo.
          </div>
        )}

        {confirmError && (
          <div
            className="glass-panel-sm rounded-xl px-4 py-3 text-sm"
            style={{ color: "var(--color-coral)" }}
            role="alert"
          >
            {confirmError}
          </div>
        )}

        {run.status !== "en_progreso" && run.results.length > 0 && (
          <div className="flex items-center justify-between flex-wrap gap-3">
            <label
              className="text-sm flex items-center gap-2"
              style={{ color: "var(--text-secondary)" }}
            >
              <input
                type="checkbox"
                checked={showSinNovedad}
                onChange={(e) => setShowSinNovedad(e.target.checked)}
              />
              Mostrar sin novedades {hiddenCount > 0 ? `(${hiddenCount})` : ""}
            </label>

            <Button
              onClick={handleConfirmSelected}
              isLoading={isConfirming}
              disabled={selected.size === 0}
            >
              Confirmar seleccionados ({selected.size})
            </Button>
          </div>
        )}

        {run.results.length === 0 && run.status !== "en_progreso" ? (
          <div className="glass-panel rounded-3xl p-8 text-center" style={{ color: "var(--text-secondary)" }}>
            Este escaneo no produjo resultados.
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {visibleResults.map((result) => (
              <ScanResultRow
                key={result.scan_result_id}
                result={result}
                isSelected={selected.has(result.scan_result_id)}
                onToggleSelect={() => toggleSelect(result.scan_result_id)}
                writeStatus={writeInfo[result.scan_result_id]?.status}
                writeDetail={writeInfo[result.scan_result_id]?.detail}
                onRetry={() => handleRetry(result.scan_result_id)}
                isRetrying={retryingId === result.scan_result_id}
              />
            ))}
          </ul>
        )}

        {run.status !== "en_progreso" && selectableCount === 0 && run.results.length > 0 && (
          <p className="text-sm text-center" style={{ color: "var(--text-secondary)" }}>
            No queda nada pendiente de confirmar en este escaneo.
          </p>
        )}

        <Link
          to="/"
          className="text-sm underline underline-offset-2 self-start"
          style={{ color: "var(--text-secondary)" }}
        >
          ← Volver al dashboard
        </Link>
      </main>
    </div>
  );
}

function RunStatusBadge({ status }: { status: ScanRunStatus }) {
  const map: Record<ScanRunStatus, { label: string; variant: "mint" | "amber" | "coral" | "dusk" }> = {
    en_progreso: { label: "En curso", variant: "dusk" },
    completado: { label: "Completado", variant: "mint" },
    completado_con_errores: { label: "Completado con errores", variant: "amber" },
    fallo_total: { label: "Fallo total", variant: "coral" },
  };
  const { label, variant } = map[status];
  return <Badge variant={variant}>{label}</Badge>;
}
