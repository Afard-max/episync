import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  // Falla al arrancar, no en el primer query: un servidor que "levanta bien"
  // pero no puede hablar con su base es peor que uno que ni siquiera arranca.
  throw new Error(
    "DATABASE_URL no está definida. Revisá tu .env (debe vivir en backend/.env, no en la raíz del repo)."
  );
}

// ssl se pasa explícito, no se depende de que postgres.js interprete
// "sslmode=require" embebido en la URL (comportamiento no garantizado
// igual al de drizzle-kit, que sí lo tomó de la URL sin problema).
// connect_timeout evita que una conexión que nunca cierra deje el server
// colgado para siempre en vez de fallar con un error claro.
const queryClient = postgres(connectionString, {
  ssl: "require",
  connect_timeout: 10,
});

export const db = drizzle(queryClient, { schema });
