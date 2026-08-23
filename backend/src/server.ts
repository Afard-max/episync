import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import usersRoutes from "./routes/users.js";
import malRoutes from "./routes/mal.js";

const app = Fastify({ logger: true });

await app.register(rateLimit, {
  max: Number(process.env.RATE_LIMIT_MAX ?? 100),
  timeWindow: "1 minute",
});

app.get("/health", async () => ({ status: "ok" }));

await app.register(usersRoutes, { prefix: "/api/v1" });

await app.register(malRoutes, { prefix: "/api/v1" });

const port = Number(process.env.PORT ?? 3000);
app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
