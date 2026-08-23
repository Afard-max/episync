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

// ssl como objeto explícito, no el string "require": necesitamos forzar
// maxVersion TLSv1.2 porque TLS 1.3 negocia por defecto el grupo híbrido
// post-cuántico X25519MLKEM768 (disponible en OpenSSL 3.5+), que tiene un
// problema de interoperabilidad confirmado con el proxy TLS de Render — el
// handshake completa pero la conexión se corta al enviar el primer mensaje
// de protocolo real. Verificado manualmente con psql forzando TLS 1.2 antes
// de aplicar este fix. rejectUnauthorized:false replica la semántica de
// sslmode=require de libpq (cifra, no verifica cadena de certificados).
const queryClient = postgres(connectionString, {
  ssl: {
    rejectUnauthorized: false,
    maxVersion: "TLSv1.2",
  },
  connect_timeout: 10,
});

export const db = drizzle(queryClient, { schema });
