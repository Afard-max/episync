# EpisoSync

Sincronización **asistida** (no automática) de episodios vistos entre
[AnimeAV1](https://animeav1.com) y [MyAnimeList](https://myanimelist.net).
Proyecto personal, de un solo usuario/una sola cuenta de invitación —no un
producto multi-tenant público.

**App en producción**: https://episync-1.onrender.com/

El diseño completo (arquitectura, modelo de datos, decisiones técnicas)
vive en `SDD_EpisoSync.md`. Este README es la puerta de entrada práctica:
qué es, cómo se corre, y qué falta.

## Por qué existe

MyAnimeList no se entera solo de que viste un episodio nuevo en un sitio
de streaming. EpisoSync cierra ese hueco, pero **nunca escribe en tu
cuenta de MAL sin que vos lo confirmes explícitamente, episodio por
episodio**. El flujo tiene dos fases separadas a propósito:

1. **Escaneo (solo lectura)** — recorre tu watchlist activa, mira qué
   episodio va en AnimeAV1 para cada título, y lo compara contra lo que
   tenés registrado en MAL. No toca MAL en este paso.
2. **Confirmación (escritura)** — vos elegís, resultado por resultado,
   cuáles confirmar. Recién ahí se escribe en tu lista de MAL.

Cualquier resultado "raro" (salto de más de un episodio, un episodio
detectado *menor* al que ya tenías registrado, o un título que no matchea
ningún slug de AnimeAV1) se marca como **advertencia**, no se aplica
solo ni se descarta en silencio — queda para que lo revises vos.

## Stack

| | |
|---|---|
| **Backend** | Fastify 5 + TypeScript, Drizzle ORM sobre PostgreSQL, Zod para validación, `cheerio` para el scraping de AnimeAV1 |
| **Frontend** | React 19 + Vite + TypeScript + Tailwind CSS v4, PWA (`vite-plugin-pwa`) |
| **Monorepo** | pnpm workspaces (`backend` y `frontend` como paquetes hermanos, un solo lockfile en la raíz) |
| **Infra** | PostgreSQL en Render, backend desplegado como Web Service en Render |

## Estructura

```
episync-mal/
├── backend/
│   └── src/
│       ├── modules/
│       │   ├── storage/          # schema Drizzle, cliente DB, cifrado de tokens, API keys
│       │   ├── mal-integration/  # OAuth2/PKCE, refresh transparente, escritura en MAL
│       │   └── extraction/       # scraping de AnimeAV1, clasificación de resultados
│       └── routes/                # endpoints REST, uno por área del contrato
├── frontend/
│   └── src/
│       ├── pages/                 # las 5 pantallas: login, dashboard, reporte de
│       │                          # escaneo, watchlist, cuenta
│       ├── components/
│       ├── context/                # tema (dark/light) y sesión (API key)
│       └── lib/                    # cliente de API tipado, contra el contrato 1:1
├── pnpm-workspace.yaml
└── SDD_EpisoSync.md                # diseño completo, léelo antes de tocar arquitectura
```

## Cómo se usa (flujo real)

1. Alguien con acceso previo te da de alta (`POST /users`, requiere una
   clave de invitación) y te da tu API key **una única vez** — el backend
   solo guarda su hash, no hay forma de volver a mostrarla después.
2. Conectás tu cuenta de MyAnimeList vía OAuth2/PKCE desde la pantalla de
   cuenta.
3. Cargás tu watchlist de la temporada (título, id de MAL, episodio actual).
4. Disparás un escaneo. Es asíncrono — el frontend hace polling hasta que
   termina.
5. Revisás el reporte, seleccionás qué confirmar, confirmás. Eso es lo
   único que efectivamente escribe en tu MAL.

## Cómo correrlo local

Requisitos: Node ≥20, [pnpm](https://pnpm.io), una base PostgreSQL
accesible (Render u otra), y una app registrada en el
[panel de desarrollador de MAL](https://myanimelist.net/apiconfig) (tipo
`web`, con su Client ID/Secret propios).

```bash
git clone git@github.com:Afard-max/episync.git
cd episync
pnpm install
```

**Variables de entorno** — importante: la plantilla vive en la raíz
(`.env.example`), pero el archivo real que el backend lee es
**`backend/.env`**, no uno en la raíz del repo (confusión fácil, ya nos
pasó):

```bash
cp .env.example backend/.env
# completar con tus propios valores: DATABASE_URL, MAL_CLIENT_ID,
# MAL_CLIENT_SECRET, MAL_REDIRECT_URI, TOKEN_ENCRYPTION_KEY,
# APP_JWT_SECRET, INVITE_SECRET
cp frontend/.env.example frontend/.env
# VITE_API_BASE_URL apuntando a tu backend local (http://localhost:3000
# por defecto)
```

Aplicar el schema a la base:

```bash
pnpm --filter episync-backend db:push
```

Levantar ambos servicios (dos terminales, o `dev:backend`/`dev:frontend`
desde la raíz):

```bash
pnpm dev:backend    # Fastify en :3000
pnpm dev:frontend   # Vite en :5173
```

## Deploy

Toda la aplicación está en producción, en Render.

**Backend** — Web Service, monorepo pnpm en un único servicio:

- **Root Directory**: vacío (raíz del repo) — el install necesita correr
  ahí para resolver el lockfile compartido del workspace.
- **Build Command**: `pnpm install --frozen-lockfile && pnpm --filter episync-backend build`
- **Start Command**: `pnpm --filter episync-backend start`
- **Health Check Path**: `/health`
- Variables de entorno cargadas directo en el dashboard de Render (nunca
  vía archivo `.env` commiteado — no existe en producción, por diseño).
  `FRONTEND_URL` apunta a la URL del Static Site de abajo (necesario para
  que CORS deje pasar los pedidos del frontend real).
- URL: `https://episync-785t.onrender.com`

**Frontend** — Static Site:

- **Root Directory**: `frontend` — a diferencia del backend, acá sí se
  apunta directo a la carpeta del paquete. Sigue funcionando con pnpm
  workspaces porque `pnpm install` resuelve el `pnpm-workspace.yaml`
  subiendo por los directorios padre, no depende de ejecutarse desde la
  raíz.
- **Build Command**: `pnpm install --frozen-lockfile && pnpm --filter episosync-frontend build`
- **Publish Directory**: `dist` (relativo al Root Directory `frontend` de
  arriba, no a la raíz del repo — Render resuelve todos los paths de un
  servicio relativos a su propio Root Directory, confirmado en su
  documentación oficial de monorepos).
- `VITE_API_BASE_URL` apuntando a la URL del backend de arriba.
- URL: `https://episync-1.onrender.com`

`MAL_REDIRECT_URI` (tanto en Render como en el panel de MAL) apunta al
callback del backend desplegado, no a localhost — ver el gotcha
correspondiente más abajo si en algún momento hace falta volver a
desarrollo local.

## Gotchas conocidos (para no perder tiempo redescubriéndolos)

- **TLS 1.3 vs Render Postgres**: la conexión a la base fuerza
  `maxVersion: "TLSv1.2"` en `db.ts`. TLS 1.3 negocia por defecto un grupo
  de intercambio de claves post-cuántico (`X25519MLKEM768`) que tiene un
  problema de interoperabilidad confirmado con el proxy TLS de Render — el
  handshake completa pero la conexión se corta al primer mensaje real. Si
  algo rompe la conexión a la base después de actualizar dependencias,
  este es el primer sospechoso.
- **`MAL_REDIRECT_URI` es una sola URL por app registrada en MAL.** No hay
  forma de tener local y producción funcionando al mismo tiempo con una
  sola app — hay que cambiar el campo manualmente en el panel de MAL (y la
  variable de entorno correspondiente) cada vez que se alterna entre
  ambos, o registrar una segunda app dedicada a producción.
- **El script `start` del backend no usa `--env-file`** (a diferencia de
  `dev`, que sí) — a propósito: en producción no hay ningún `.env`
  commiteado, las variables las inyecta la plataforma de hosting
  directamente.

## Seguridad

- Las API keys propias del sistema se guardan como hash (no en texto
  plano); se muestran una única vez, al darse de alta.
- Los tokens de OAuth de MAL se cifran (AES-256-GCM) antes de persistirse.
- El estado OAuth (`state`) va firmado con HMAC para prevenir CSRF durante
  el intercambio con MAL.
- Nunca commitear `backend/.env` ni `frontend/.env` — están en
  `.gitignore`, y así deben quedarse.

## Estado actual

Proyecto completo, en producción, flujo end-to-end funcionando:

- ✅ Backend: alta de usuarios, conexión/desconexión con MAL, CRUD de
  watchlist, escaneo asíncrono, confirmación de escritura en MAL con
  refresh transparente de token — desplegado.
- ✅ Frontend: las 5 pantallas del diseño original, funcionando de punta a
  punta contra el backend real — desplegado.
