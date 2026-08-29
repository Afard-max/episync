import { useState } from "react";
import type { PatchWatchlistItemInput, WatchlistItem } from "../lib/types";
import { watchlistStatusLabel } from "../lib/format";
import { SelectField } from "./SelectField";
import { Button } from "./Button";
import { FilmstripProgress } from "./FilmstripProgress";

interface WatchlistConfigRowProps {
  item: WatchlistItem;
  onPatch: (patch: PatchWatchlistItemInput) => Promise<void>;
  onDelete: () => Promise<void>;
  error?: string;
}

// Se remonta (via key={item.id + item.updated_at} en el padre) cada vez
// que el backend confirma un cambio, así el estado local de los inputs
// no queda desincronizado del valor real sin necesidad de un useEffect
// de sincronización.
export function WatchlistConfigRow({
  item,
  onPatch,
  onDelete,
  error,
}: WatchlistConfigRowProps) {
  const [malAnimeId, setMalAnimeId] = useState(String(item.mal_anime_id));
  const [currentEpisode, setCurrentEpisode] = useState(String(item.current_episode));
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  async function commitIfChanged(field: "mal_anime_id" | "current_episode") {
    const raw = field === "mal_anime_id" ? malAnimeId : currentEpisode;
    const parsed = Number(raw);
    const original = field === "mal_anime_id" ? item.mal_anime_id : item.current_episode;
    if (!Number.isInteger(parsed) || parsed < 0 || parsed === original) {
      // Valor inválido o sin cambios: se revierte al original en vez de
      // mandar un PATCH inútil o corrupto.
      if (field === "mal_anime_id") setMalAnimeId(String(item.mal_anime_id));
      else setCurrentEpisode(String(item.current_episode));
      return;
    }
    setIsSaving(true);
    await onPatch({ [field]: parsed } as PatchWatchlistItemInput);
    setIsSaving(false);
  }

  async function handleStatusChange(status: WatchlistItem["status"]) {
    setIsSaving(true);
    await onPatch({ status });
    setIsSaving(false);
  }

  async function handleDelete() {
    if (!window.confirm(`¿Eliminar "${item.site_title}" de la watchlist?`)) return;
    setIsDeleting(true);
    await onDelete();
    // No hace falta setIsDeleting(false): si onDelete tiene éxito, el
    // padre saca esta fila del array y el componente se desmonta.
  }

  return (
    <li className="glass-panel rounded-2xl p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <p className="font-medium min-w-0 truncate">{item.site_title}</p>
        <FilmstripProgress episode={item.current_episode} size="sm" />
      </div>

      <div className="flex items-end gap-3 flex-wrap">
        <label className="flex flex-col gap-1.5 text-sm">
          <span style={{ color: "var(--text-secondary)" }}>ID en MAL</span>
          <input
            type="number"
            min={1}
            value={malAnimeId}
            onChange={(e) => setMalAnimeId(e.target.value)}
            onBlur={() => commitIfChanged("mal_anime_id")}
            className="glass-panel-sm rounded-xl px-3 py-2 w-28"
            style={{ color: "var(--text-primary)" }}
          />
        </label>

        <label className="flex flex-col gap-1.5 text-sm">
          <span style={{ color: "var(--text-secondary)" }}>Episodio actual</span>
          <input
            type="number"
            min={0}
            value={currentEpisode}
            onChange={(e) => setCurrentEpisode(e.target.value)}
            onBlur={() => commitIfChanged("current_episode")}
            className="glass-panel-sm rounded-xl px-3 py-2 w-24"
            style={{ color: "var(--text-primary)" }}
          />
        </label>

        <SelectField
          aria-label="Estado"
          value={item.status}
          onChange={(e) => handleStatusChange(e.target.value as WatchlistItem["status"])}
        >
          {Object.entries(watchlistStatusLabel).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </SelectField>

        <Button
          variant="danger"
          onClick={handleDelete}
          isLoading={isDeleting}
          className="ml-auto"
        >
          Eliminar
        </Button>
      </div>

      {isSaving && (
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
          Guardando…
        </p>
      )}
      {error && (
        <p className="text-xs" style={{ color: "var(--color-coral)" }}>
          {error}
        </p>
      )}
    </li>
  );
}
