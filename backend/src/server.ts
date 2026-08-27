import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import usersRoutes from "./routes/users.js";
import malRoutes from "./routes/mal.js";
import watchlistRoutes from "./routes/watchlist.js";
import scanRunsRoutes from "./routes/scan-runs.js";

const app = Fastify({ logger: true });

// Sin esto, cualquier pedido cross-origin desde el navegador (el frontend
// en :5173 contra este backend en :3000) falla en la preflight OPTIONS
// antes de llegar siquiera a una ruta real — Fastify no la responde por
// su cuenta. FRONTEND_URL ya existe como variable de entorno para el
// callback OAuth de MAL (§2.2); se reusa acá como fuente única de la
// verdad para el origen permitido, con localhost:5173 como default de
// desarrollo si todavía no la configuraste.
await app.register(cors, {
  origin: process.env.FRONTEND_URL ?? "http://localhost:5173",
});

await app.register(rateLimit, {
  max: Number(process.env.RATE_LIMIT_MAX ?? 100),
  timeWindow: "1 minute",
});

app.get("/health", async () => ({ status: "ok" }));

await app.register(usersRoutes, { prefix: "/api/v1" });

await app.register(malRoutes, { prefix: "/api/v1" });

await app.register(watchlistRoutes, { prefix: "/api/v1" });

await app.register(scanRunsRoutes, { prefix: "/api/v1" });

const port = Number(process.env.PORT ?? 3000);
app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
