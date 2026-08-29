import { Badge } from "./Badge";
import { Button } from "./Button";
import type { ScanResult } from "../lib/types";
import { outcomeLabel, outcomeVariant } from "../lib/format";

interface ScanResultRowProps {
  result: ScanResult;
  isSelected: boolean;
  onToggleSelect: () => void;
  /** Estado de escritura conocido en ESTA sesión (viene de la respuesta
   *  de /confirm o /retry). undefined si confirmed=true pero la página
   *  se cargó/recargó sin haber visto esa respuesta — el contrato no
   *  distingue éxito de fallo en GET /scan-runs/:id, solo confirmed. */
  writeStatus?: "ok" | "error";
  writeDetail?: string;
  onRetry: () => void;
  isRetrying: boolean;
}

export function ScanResultRow({
  result,
  isSelected,
  onToggleSelect,
  writeStatus,
  writeDetail,
  onRetry,
  isRetrying,
}: ScanResultRowProps) {
  const isSelectable = !result.confirmed && result.episode_found !== null;

  return (
    <li className="glass-panel rounded-2xl p-4 flex items-center gap-4 flex-wrap">
      {!result.confirmed && (
        <label
          className="flex h-11 w-11 -m-3 shrink-0 items-center justify-center cursor-pointer"
          aria-label={`Seleccionar ${result.site_title}`}
        >
          <input
            type="checkbox"
            checked={isSelected}
            onChange={onToggleSelect}
            disabled={!isSelectable}
            className="h-5 w-5 accent-current"
            style={{ color: "var(--accent)" }}
          />
        </label>
      )}

      <div className="min-w-0 flex-1">
        <p className="font-medium truncate">{result.site_title}</p>
        <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
          Ep. {result.episode_current_mal}
          {result.episode_found !== null && result.episode_found !== result.episode_current_mal
            ? ` → ${result.episode_found}`
            : ""}
        </p>
        {result.detail && (
          <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>
            {result.detail}
          </p>
        )}
        {writeStatus === "error" && writeDetail && (
          <p className="text-xs mt-1" style={{ color: "var(--color-coral)" }}>
            {writeDetail}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <Badge variant={outcomeVariant[result.outcome]}>
          {outcomeLabel[result.outcome]}
        </Badge>

        {result.confirmed && writeStatus === "ok" && (
          <Badge variant="mint">Confirmado ✓</Badge>
        )}

        {result.confirmed && writeStatus === "error" && (
          <Button variant="danger" onClick={onRetry} isLoading={isRetrying}>
            Reintentar
          </Button>
        )}

        {result.confirmed && writeStatus === undefined && (
          <div className="flex items-center gap-2">
            <Badge variant="dusk">Confirmado</Badge>
            <button
              onClick={onRetry}
              disabled={isRetrying}
              className="text-xs underline underline-offset-2 disabled:opacity-50"
              style={{ color: "var(--text-secondary)" }}
              title="No se sabe si esta confirmación fue exitosa (se cargó en otra sesión) — reintentar es seguro, vuelve a escribir el mismo valor."
            >
              {isRetrying ? "Reintentando…" : "¿Falló? Reintentar"}
            </button>
          </div>
        )}
      </div>
    </li>
  );
}
