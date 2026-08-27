import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../context/AuthContext";
import {
  ApiError,
  createWatchlistItem,
  deleteWatchlistItem,
  getWatchlist,
  updateActiveSeason,
  updateWatchlistItem,
} from "../lib/api";
import type { WatchlistItem, WatchlistStatus } from "../lib/types";
import { Topbar } from "../components/Topbar";
import { Button } from "../components/Button";
import { TextField } from "../components/TextField";
import { SelectField } from "../components/SelectField";
import { WatchlistConfigRow } from "../components/WatchlistConfigRow";
import { watchlistStatusLabel } from "../lib/format";

export function WatchlistConfigPage() {
  const { apiKey, user, refreshUser } = useAuth();

  // Temporada que se está viendo/editando — arranca en la activa del
  // usuario, pero se puede cambiar para crear o revisar otra sin que eso
  // la marque como activa automáticamente (eso es una acción aparte).
  const [seasonInput, setSeasonInput] = useState(user?.active_season_label ?? "");
  const [viewingSeason, setViewingSeason] = useState<string | null>(
    user?.active_season_label ?? null
  );
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSettingActive, setIsSettingActive] = useState(false);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  const [newTitle, setNewTitle] = useState("");
  const [newMalId, setNewMalId] = useState("");
  const [newEpisode, setNewEpisode] = useState("0");
  const [newStatus, setNewStatus] = useState<WatchlistStatus>("watching");
  const [isAdding, setIsAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const loadItems = useCallback(
    async (season: string) => {
      if (!apiKey) return;
      setIsLoading(true);
      setLoadError(null);
      try {
        const result = await getWatchlist(apiKey, season);
        setItems(result.items);
      } catch (err) {
        setLoadError(
          err instanceof ApiError ? err.message : "No se pudo cargar la watchlist."
        );
      } finally {
        setIsLoading(false);
      }
    },
    [apiKey]
  );

  useEffect(() => {
    if (viewingSeason) void loadItems(viewingSeason);
  }, [viewingSeason, loadItems]);

  function handleViewSeason(event: FormEvent) {
    event.preventDefault();
    const trimmed = seasonInput.trim();
    if (!trimmed) return;
    setViewingSeason(trimmed);
  }

  async function handleSetActive() {
    if (!apiKey || !viewingSeason) return;
    setIsSettingActive(true);
    try {
      await updateActiveSeason(apiKey, viewingSeason);
      await refreshUser();
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "No se pudo marcar la temporada como activa."
      );
    } finally {
      setIsSettingActive(false);
    }
  }

  async function handleAddItem(event: FormEvent) {
    event.preventDefault();
    if (!apiKey || !viewingSeason) return;
    const malAnimeId = Number(newMalId);
    const currentEpisode = Number(newEpisode);
    if (!Number.isInteger(malAnimeId) || malAnimeId <= 0) {
      setAddError("El ID de MAL tiene que ser un número entero positivo.");
      return;
    }
    if (!Number.isInteger(currentEpisode) || currentEpisode < 0) {
      setAddError("El episodio actual tiene que ser un número entero ≥ 0.");
      return;
    }
    setIsAdding(true);
    setAddError(null);
    try {
      const created = await createWatchlistItem(apiKey, {
        season_label: viewingSeason,
        site_title: newTitle.trim(),
        mal_anime_id: malAnimeId,
        current_episode: currentEpisode,
        status: newStatus,
      });
      setItems((prev) => [...prev, created]);
      setNewTitle("");
      setNewMalId("");
      setNewEpisode("0");
      setNewStatus("watching");
    } catch (err) {
      setAddError(
        err instanceof ApiError
          ? err.code === "duplicate_item"
            ? "Ya tenés un título con ese nombre en esta temporada."
            : err.message
          : "No se pudo agregar el título."
      );
    } finally {
      setIsAdding(false);
    }
  }

  async function handlePatch(itemId: string, patch: Parameters<typeof updateWatchlistItem>[2]) {
    if (!apiKey) return;
    setRowErrors((prev) => ({ ...prev, [itemId]: "" }));
    try {
      const updated = await updateWatchlistItem(apiKey, itemId, patch);
      setItems((prev) => prev.map((it) => (it.id === itemId ? updated : it)));
    } catch (err) {
      setRowErrors((prev) => ({
        ...prev,
        [itemId]: err instanceof ApiError ? err.message : "No se pudo guardar el cambio.",
      }));
    }
  }

  async function handleDelete(itemId: string) {
    if (!apiKey) return;
    try {
      await deleteWatchlistItem(apiKey, itemId);
      setItems((prev) => prev.filter((it) => it.id !== itemId));
    } catch (err) {
      setRowErrors((prev) => ({
        ...prev,
        [itemId]: err instanceof ApiError ? err.message : "No se pudo eliminar el título.",
      }));
    }
  }

  const isActiveSeason = viewingSeason !== null && viewingSeason === user?.active_season_label;

  return (
    <div className="min-h-dvh ambient-glow">
      <Topbar />
      <main className="p-6 max-w-3xl mx-auto flex flex-col gap-6">
        <h1 className="text-2xl font-semibold">Configuración de watchlist</h1>

        <form onSubmit={handleViewSeason} className="glass-panel rounded-2xl p-5 flex flex-col gap-3">
          <TextField
            label="Temporada (season_label)"
            value={seasonInput}
            onChange={(e) => setSeasonInput(e.target.value)}
            placeholder="ej. otoño-2026"
            required
          />
          <div className="flex items-center gap-3 flex-wrap">
            <Button type="submit" variant="ghost">
              Ver / crear esta temporada
            </Button>
            {viewingSeason && !isActiveSeason && (
              <Button type="button" onClick={handleSetActive} isLoading={isSettingActive}>
                Marcar como temporada activa
              </Button>
            )}
            {viewingSeason && isActiveSeason && (
              <span className="text-sm" style={{ color: "var(--color-mint)" }}>
                ✓ Esta es tu temporada activa
              </span>
            )}
          </div>
        </form>

        {viewingSeason && (
          <>
            <form
              onSubmit={handleAddItem}
              className="glass-panel rounded-2xl p-5 flex flex-col gap-3"
            >
              <h2 className="font-medium">
                Agregar título a {viewingSeason}
              </h2>
              <div className="grid sm:grid-cols-2 gap-3">
                <TextField
                  label="Título (como aparece en AnimeAV1)"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  required
                />
                <TextField
                  label="ID en MAL"
                  type="number"
                  min={1}
                  value={newMalId}
                  onChange={(e) => setNewMalId(e.target.value)}
                  placeholder="ej. 52991"
                  required
                />
                <TextField
                  label="Episodio actual"
                  type="number"
                  min={0}
                  value={newEpisode}
                  onChange={(e) => setNewEpisode(e.target.value)}
                  required
                />
                <SelectField
                  label="Estado"
                  value={newStatus}
                  onChange={(e) => setNewStatus(e.target.value as WatchlistStatus)}
                >
                  {Object.entries(watchlistStatusLabel).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </SelectField>
              </div>
              {addError && (
                <p className="text-sm" style={{ color: "var(--color-coral)" }}>
                  {addError}
                </p>
              )}
              <Button type="submit" isLoading={isAdding} className="self-start">
                Agregar
              </Button>
            </form>

            {isLoading ? (
              <div
                className="glass-panel rounded-3xl p-8 text-center"
                style={{ color: "var(--text-secondary)" }}
              >
                Cargando…
              </div>
            ) : loadError ? (
              <div className="glass-panel rounded-3xl p-8" style={{ color: "var(--color-coral)" }}>
                {loadError}
              </div>
            ) : items.length === 0 ? (
              <div
                className="glass-panel rounded-3xl p-8 text-center"
                style={{ color: "var(--text-secondary)" }}
              >
                Todavía no hay títulos en {viewingSeason}.
              </div>
            ) : (
              <ul className="flex flex-col gap-3">
                {items.map((item) => (
                  <WatchlistConfigRow
                    key={`${item.id}-${item.updated_at}`}
                    item={item}
                    onPatch={(patch) => handlePatch(item.id, patch)}
                    onDelete={() => handleDelete(item.id)}
                    error={rowErrors[item.id]}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </main>
    </div>
  );
}
