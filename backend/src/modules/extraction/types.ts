export interface ExtractionSuccess {
  ok: true;
  latestEpisode: number;
}

export interface ExtractionFailure {
  ok: false;
  reason: string;
  // Distingue "el slug no existe en la fuente" (404 -> mapeo de título no
  // resuelto, SDD §3.4.5 tabla de contingencias) de cualquier otro fallo
  // (sitio caído, timeout, HTML con forma inesperada -> outcome "error").
  // Sin este flag, el llamador tendría que adivinar el tipo de fallo
  // comparando substrings del mensaje, que es frágil.
  notFound: boolean;
}

export type ExtractionResult = ExtractionSuccess | ExtractionFailure;

/**
 * Punto de extensión explícito exigido por SDD §3.4.5 ("Discrepancia de
 * título" y "El sitio migra a renderizado dinámico"): permite sustituir
 * la implementación basada en cheerio por una basada en navegador headless
 * (o agregar una fuente alternativa a AnimeAV1) sin tocar el resto del
 * sistema (rutas de scan-runs, outcome.ts).
 */
export interface ISourceProvider {
  getLatestEpisode(siteTitle: string): Promise<ExtractionResult>;
}
