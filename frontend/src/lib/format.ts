export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es-AR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const watchlistStatusLabel: Record<
  "watching" | "hiatus" | "dropped",
  string
> = {
  watching: "Viendo",
  hiatus: "En pausa",
  dropped: "Abandonado",
};

export const outcomeLabel: Record<
  "ok" | "sin_novedad" | "advertencia" | "error",
  string
> = {
  ok: "Novedad",
  sin_novedad: "Sin novedad",
  advertencia: "Advertencia",
  error: "Error",
};

export const outcomeVariant: Record<
  "ok" | "sin_novedad" | "advertencia" | "error",
  "mint" | "amber" | "coral" | "dusk"
> = {
  ok: "mint",
  sin_novedad: "dusk",
  advertencia: "amber",
  error: "coral",
};
