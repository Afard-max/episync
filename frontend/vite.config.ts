import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// EpisoSync frontend — ver /mnt/skills o SDD §3.6.1: PWA instalable,
// no se cachea contenido dinámico de escaneo (solo assets estáticos).
export default defineConfig({
  resolve: {
    alias: {
      "@": "/src",
    },
  },
  // Target moderno explícito: el default de Vite (chrome87/safari14/etc.,
  // ~2020) hace que esbuild intente "bajar de versión" sintaxis reciente
  // que trae react-router 7.18.x (su build de "framework mode") y falla al
  // transformar cierto destructuring. No hay necesidad real de soportar
  // navegadores de esa época acá, así que se sube el target y esbuild deja
  // de necesitar esa transformación.
  build: {
    target: "es2022",
  },
  optimizeDeps: {
    esbuildOptions: {
      target: "es2022",
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "icons/*.png"],
      manifest: {
        name: "EpisoSync",
        short_name: "EpisoSync",
        description:
          "Detección semi-automatizada de episodios estrenados con actualización asistida en MyAnimeList.",
        theme_color: "#1B1F2A",
        background_color: "#1B1F2A",
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "/icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/icons/icon-512-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // SDD §3.6.1: no cachear contenido dinámico de escaneo. Solo
        // precachea el shell de la app (JS/CSS/HTML/fuentes/iconos); las
        // llamadas a /api/v1/* nunca deben resolverse desde caché.
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  server: {
    port: 5173,
  },
});
