interface FilmstripProgressProps {
  episode: number;
  size?: "sm" | "md";
}

// Elemento de firma del proyecto: en vez de una barra de progreso
// genérica (no hay "total de episodios" en el schema para calcular un
// porcentaje — WatchlistItem solo guarda current_episode), el episodio
// actual se enmarca como un fotograma de filmstrip con perforaciones,
// coherente con el favicon y el ícono de la PWA.
export function FilmstripProgress({ episode, size = "md" }: FilmstripProgressProps) {
  const height = size === "sm" ? "h-8" : "h-10";
  const textSize = size === "sm" ? "text-sm" : "text-base";
  const holeSize = size === "sm" ? "h-1.5 w-1.5" : "h-2 w-2";

  return (
    <div
      className={`inline-flex items-stretch rounded-lg overflow-hidden ${height}`}
      style={{ background: "var(--color-ink)" }}
      title={`Episodio ${episode}`}
    >
      <Sprockets holeSize={holeSize} />
      <div
        className={`flex items-center justify-center px-3 font-mono font-medium ${textSize}`}
        style={{ background: "var(--color-coral)", color: "var(--color-ink)" }}
      >
        Ep. {episode}
      </div>
      <Sprockets holeSize={holeSize} />
    </div>
  );
}

function Sprockets({ holeSize }: { holeSize: string }) {
  return (
    <div className="flex flex-col items-center justify-evenly px-1.5 py-1">
      <span className={`${holeSize} rounded-[1px]`} style={{ background: "var(--color-mist)" }} />
      <span className={`${holeSize} rounded-[1px]`} style={{ background: "var(--color-mist)" }} />
      <span className={`${holeSize} rounded-[1px]`} style={{ background: "var(--color-mist)" }} />
    </div>
  );
}
