import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";

const app = Fastify({ logger: true });

// Rate limiting global de base (§4.4 del SDD).
// Los límites específicos por endpoint (60/min lectura, 4/min scan-runs,
// 10/min confirm) se aplican por-ruta cuando lleguemos a esos módulos,
// no acá; esto es solo el techo global de seguridad.
await app.register(rateLimit, {
  max: Number(process.env.RATE_LIMIT_MAX ?? 100),
  timeWindow: "1 minute",
});

app.get("/health", async () => ({ status: "ok" }));

const port = Number(process.env.PORT ?? 3000);
app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
