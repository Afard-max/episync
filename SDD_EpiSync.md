# Software Design Document (SDD)
## Proyecto: EpisoSync — Sistema de Sincronización Asistida AnimeAV1 → MyAnimeList

**Versión:** 1.0
**Fecha:** 2026-08-13
**Autor de la propuesta original:** Alex
**Elaboración del SDD:** Claude, a partir de los lineamientos provistos

**Nota de rigor metodológico:** los datos técnicos sobre AnimeAV1 citados en este documento fueron verificados mediante inspección directa de la página (`https://animeav1.com/` y `https://animeav1.com/media/yani-neko/7`) el 13/08/2026, no por conjetura. Los datos sobre la API de MyAnimeList provienen de documentación oficial y especificaciones no oficiales de terceros contrastadas por búsqueda; se marcan como tal donde corresponde. Cualquier afirmación no verificable se señala explícitamente como supuesto de diseño.

---

## 0. Validación y Configuración del Espacio de Trabajo (Fase 0, previa a toda implementación)

Antes de escribir una sola línea de código de la Fase 1, debe verificarse y dejarse configurado lo siguiente. Esta fase es un prerrequisito bloqueante.

### 0.1. Herramientas de entorno (máquina de desarrollo, Ubuntu)

| Herramienta | Versión mínima requerida | Verificación | Estado en tu entorno (según contexto conocido) |
|---|---|---|---|
| Node.js | 20 LTS | `node -v` | Presente vía `nvm` |
| pnpm | 9.x | `pnpm -v` | Presente vía corepack |
| Git | cualquiera reciente | `git --version` | Configurado (SSH bajo `Afard-max`) |
| Docker + Docker Compose | 24.x / v2 | `docker -v && docker compose version` | **No confirmado** — verificar con `service_tools --active` |
| SQLite3 CLI (si se opta por SQLite) | 3.4x | `sqlite3 --version` | No confirmado |
| Cliente `psql` (si se opta por PostgreSQL) | 15+ | `psql --version` | No confirmado |

**Acción requerida antes de continuar:** ejecutar `service_tools --active` para confirmar si `docker` y `docker.socket` están activos, e instalar lo faltante. No se debe asumir la presencia de Docker sin esta verificación explícita.

### 0.2. Credenciales y registros externos (bloqueantes)

1. **Aplicación MAL API:** registrar una aplicación en el panel de API de MyAnimeList (Cuenta → Configuración → API → Create ID). Esto entrega un `Client ID` (y opcionalmente `Client Secret`, no obligatorio si se usa el flujo público con PKCE). Sin este registro, ningún otro paso del backend puede probarse.
2. **Cuenta de despliegue backend:** decidir y crear cuenta en el proveedor elegido (ver §3.4.4).
3. **Cuenta de despliegue frontend:** Cloudflare Pages (ya en uso para `alesito.dev` y `malmetrics`, por consistencia operativa).
4. **Dominio o subdominio** (opcional pero recomendado) para el callback de OAuth de MAL, ya que MAL exige una URL de redirección exacta registrada de antemano.

### 0.3. Archivo de configuración de entorno

Crear `.env.example` (versionado) con **nombres** de variables, nunca valores reales, conforme al principio de gestión de secretos (§3.4.6 / requisito 4.1):

```
MAL_CLIENT_ID=
MAL_REDIRECT_URI=
TOKEN_ENCRYPTION_KEY=       # clave AES-256 generada, nunca hardcodeada
DATABASE_URL=
APP_JWT_SECRET=             # si se firman sesiones de sesión de admin
NODE_ENV=development
RATE_LIMIT_MAX=             # ver 4.4
```

### 0.4. Checklist de salida de la Fase 0

- [ ] Node 20 LTS confirmado
- [ ] pnpm confirmado
- [ ] Docker confirmado o descartado explícitamente (si se opta por despliegue sin contenedores)
- [ ] Aplicación MAL API creada, `Client ID` obtenido
- [ ] Motor de base de datos decidido (SQLite vs PostgreSQL, ver §3.5)
- [ ] `.env.example` creado y versionado
- [ ] Cuenta de despliegue backend creada

No se avanza a la Fase 1 (implementación) sin marcar los seis puntos anteriores.

---

## 3.1. Nombre de la Funcionalidad

**EpisoSync** — Sistema de detección semi-automatizada de episodios estrenados en AnimeAV1 con actualización asistida y confirmada por el usuario del contador de episodios vistos en MyAnimeList (MAL), multi-usuario mediante clave de API propia por usuario.

## 3.2. Alcance

### 3.2.1. Descripción

El sistema resuelve un problema de fricción operativa: la actualización manual y repetitiva del progreso de visionado en MAL para usuarios que siguen numerosos títulos en emisión simultánea. El sistema **no automatiza la decisión final**: solo automatiza la *detección* de novedades y prepara una actualización que el usuario debe confirmar explícitamente. Esto es una restricción de diseño explícita del usuario, no una limitación técnica — se prioriza la supervisión humana sobre la automatización completa (human-in-the-loop) para evitar errores irreversibles en una plataforma social pública (MAL es una red social; los conteos son visibles a terceros).

### 3.2.2. Objetivos

1. Eliminar la búsqueda y actualización manual repetitiva por título/episodio.
2. Permitir que el propio usuario defina, corrija o salte manualmente su progreso real (no asumir progreso lineal automático).
3. Soportar múltiples usuarios independientes sin acoplamiento de datos (multi-tenant), cada uno con su propia autorización OAuth contra MAL y su propia configuración de seguimiento.
4. Tolerar de forma explícita los modos de falla identificados por el usuario (§3.4.5).
5. Ser instalable como aplicación (PWA) en escritorio y Android.

### 3.2.3. Beneficios esperados

- Reducción del tiempo operativo diario de actualización de un proceso de N pasos manuales por anime a una revisión + un clic por sesión de escaneo.
- Trazabilidad completa: cada actualización queda registrada con su origen (fuente escaneada, episodio detectado, resultado).
- Reutilización entre temporadas mediante configuración editable (JSON gestionado desde la UI), sin reescritura de código por temporada.

### 3.2.4. Fuera de alcance (explícito)

- El sistema no descarga, reproduce ni distribuye contenido audiovisual; únicamente extrae metadatos textuales (título del post y número de episodio) ya expuestos públicamente en el HTML de AnimeAV1.
- No hay actualización automática sin confirmación humana (ninguna ejecución de escritura en MAL ocurre sin clic explícito).
- No se gestiona la creación de cuentas de MAL ni su recuperación de contraseña; el sistema delega esa responsabilidad a MAL como proveedor de identidad.

## 3.3. Definiciones y Acrónimos

| Término | Definición |
|---|---|
| **SDD** | Software Design Document, este documento. |
| **MAL** | MyAnimeList, plataforma de catalogación y red social de anime/manga. |
| **OAuth2 con PKCE** | Protocolo de autorización delegada; *Proof Key for Code Exchange* añade una verificación criptográfica adicional al flujo de código de autorización, requerido por la API v2 de MAL para clientes públicos.<cite index="3-1,4-1">La API de MyAnimeList usa OAuth2.0 con Authorization Code Grant con PKCE, y todas las solicitudes deben incluir un encabezado 'Authorization' con un token 'Bearer'</cite>. |
| **Access token / Refresh token** | El primero autoriza llamadas a la API con vigencia limitada; el segundo permite obtener un nuevo access token sin reautenticación manual del usuario. |
| **Scan Run (Ejecución de escaneo)** | Una invocación puntual y manual del proceso de extracción sobre AnimeAV1 para todos los títulos activos de un usuario, que produce un reporte sin escribir en MAL. |
| **Watchlist Config** | Configuración editable (persistida como JSON por usuario/temporada) que define qué títulos seguir, su mapeo a `mal_anime_id`, el episodio actual conocido y su estado (`watching`/`hiatus`/`dropped`). |
| **Mapeo título→ID** | Tabla manual `título_en_animeav1 → mal_anime_id`, necesaria porque no existe garantía de correspondencia 1:1 automática entre el slug de AnimeAV1 y el título canónico de MAL (romanización, traducción, títulos alternativos). |
| **SSR** | Server-Side Rendering. Verificado: el HTML de AnimeAV1 contiene el contenido final (títulos, número de episodio, navegación entre episodios) sin requerir ejecución de JavaScript del lado del cliente para ser extraído — confirmado por inspección directa de `https://animeav1.com/media/yani-neko/7`, donde la lista de episodios (`1,2,3,4,5,6,7`) está presente como enlaces `<a>` estáticos en el HTML de respuesta. |
| **PWA** | Progressive Web App: aplicación web instalable como app nativa (manifest + service worker), tanto en escritorio como en Android. |
| **Circuit Breaker** | Patrón de resiliencia que detiene temporalmente los intentos de llamada a un servicio que falla repetidamente, evitando fallos en cascada. |
| **Idempotencia** | Propiedad de una operación tal que ejecutarla múltiples veces con el mismo estado de entrada produce el mismo resultado sin efectos secundarios acumulativos. |

## 3.4. Diseño Arquitectónico

### 3.4.1. Visión general de subsistemas

El sistema se descompone en cinco subsistemas de alto nivel:

1. **Frontend PWA** — interfaz de usuario, configuración, visualización de reportes y confirmación de escritura.
2. **API Backend** — orquestación, autenticación de usuarios de la app (API key propia), autorización OAuth contra MAL, exposición de endpoints REST.
3. **Módulo de Extracción (Scraper)** — obtiene HTML de AnimeAV1 y extrae `(título_sitio, último_episodio_publicado)` por cada entrada activa de la watchlist del usuario.
4. **Módulo de Integración MAL** — gestiona el ciclo de vida OAuth2/PKCE por usuario y ejecuta las mutaciones (`PATCH` de progreso) solo tras confirmación.
5. **Almacenamiento persistente** — base de datos relacional con las entidades descritas en §3.5.

### 3.4.2. Diagrama de subsistemas y flujo de datos

```
┌──────────────────────┐         HTTPS (REST)        ┌───────────────────────────┐
│   Frontend PWA        │ ───────────────────────────▶│   API Backend (Node/TS)   │
│  (React + Vite + TS)  │◀─────────────────────────── │   Fastify + Rate Limiting │
└──────────────────────┘        JSON responses        └─────────────┬─────────────┘
                                                                     │
                        ┌────────────────────────────────────────────┼───────────────────────────┐
                        │                                             │                            │
                        ▼                                             ▼                            ▼
          ┌──────────────────────────┐              ┌───────────────────────────┐   ┌───────────────────────────┐
          │ Módulo de Extracción      │              │  Módulo de Integración MAL │   │  Almacenamiento (BD)      │
          │ (fetch HTTP + parser HTML)│              │  (OAuth2 PKCE + cliente    │   │  Usuarios, Watchlist,     │
          │ → AnimeAV1 (solo lectura) │              │   REST api.myanimelist.net)│   │  ScanRuns, ScanResults,   │
          └────────────┬──────────────┘              └──────────────┬─────────────┘   │  Tokens cifrados          │
                       │                                             │                 └───────────────────────────┘
                       ▼                                             ▼
              [ animeav1.com ]                          [ api.myanimelist.net ]
              Fuente externa,                            Servicio externo,
              no controlada                               no controlado
```

### 3.4.3. Flujo funcional (dos fases, sin escritura automática)

**Fase A — Escaneo (solo lectura, iniciado manualmente por el usuario vía botón):**
1. El backend lee la `Watchlist Config` activa del usuario (títulos con estado `watching`).
2. Para cada título, el Módulo de Extracción solicita `GET https://animeav1.com/media/{slug}` y determina el número de episodio más alto disponible en la navegación de episodios del HTML de respuesta.
3. El resultado por título (episodio encontrado, episodio actual registrado en MAL, diferencia, advertencias) se persiste como un `ScanRun` con sus `ScanResult` asociados y se devuelve a la UI. **No se escribe nada en MAL en esta fase.**

**Fase B — Confirmación (escritura, iniciada manualmente):**
4. El usuario revisa el reporte en la UI: por cada entrada, ve título, episodio actual, episodio detectado y estado (`ok`, `sin_novedad`, `advertencia`, `error`).
5. El usuario puede deseleccionar entradas individuales antes de confirmar.
6. Al presionar "Confirmar actualización", el backend ejecuta, por cada entrada seleccionada, `PATCH /v2/anime/{mal_anime_id}/my_list_status` con `num_watched_episodes` mediante el Módulo de Integración MAL, usando el token del usuario correspondiente.
7. Cada resultado de escritura (éxito/error de MAL) se registra y se muestra en la UI.

Este diseño hace que la escritura sea **idempotente**: reintentar una confirmación con el mismo valor de episodio no genera un estado inconsistente, ya que la operación establece un valor absoluto (`num_watched_episodes`), no un incremento relativo — decisión de diseño para evitar duplicar conteos si el usuario reintenta tras un error de red.

### 3.4.4. Stack tecnológico y despliegue (decisión del asistente, según lo delegado)

| Componente | Elección | Justificación |
|---|---|---|
| Frontend | React + Vite + TypeScript + Tailwind CSS, `vite-plugin-pwa` | Consistente con `malmetrics` y `alesito.dev`, ya conocido por el usuario; soporte PWA maduro y de bajo esfuerzo de configuración. |
| Backend | Node.js 20 + TypeScript + Fastify | Tipado compartido con el frontend (mismo lenguaje); Fastify aporta *rate limiting* y validación de esquema nativos, relevante para el requisito 4.4. |
| Extracción HTML | `undici`/`fetch` nativo + `cheerio` | Verificado que AnimeAV1 sirve HTML ya renderizado (SSR); **no se requiere un navegador headless** (Playwright/Puppeteer) para la extracción, lo que reduce costo de cómputo y superficie de fallos. Esto se documenta como decisión revisable: si el sitio migra a una SPA sin SSR, deberá sustituirse este módulo por uno basado en navegador headless (ver contingencia §3.4.5). |
| Base de datos | PostgreSQL gestionado (ej. Neon o Supabase, capa gratuita) | Aunque el volumen de usuarios es bajo (uso personal + un amigo), se prefiere Postgres sobre SQLite porque el despliegue backend será un servicio remoto sin disco persistente garantizado por defecto en varios proveedores gratuitos; un Postgres gestionado evita pérdida de datos por reinicio de contenedor. |
| Autenticación MAL | OAuth2 Authorization Code + PKCE, un registro de token por usuario | Requisito obligatorio de la propia API de MAL, no una elección de diseño.<cite index="4-1">Si la solicitud es para mutaciones (por ejemplo, modificar entradas de la biblioteca del usuario), el cuerpo de la solicitud se codifica como application/x-www-form-urlencoded</cite>. |
| Autenticación de la app | API key propia por usuario (token aleatorio, almacenado con hash) | Requisito explícito de multi-tenencia sin sistema de cuentas completo. |
| Backend hosting | Render, plan Hobby ($0/mes + cómputo) | Confirmado por el usuario mediante la página oficial de precios (13/08/2026): el plan Hobby permite desplegar hasta 25 servicios desde el repositorio, incluye 5 GB de ancho de banda, dominios personalizados y firewall/mitigación DDoS sin costo. Soporta variables de entorno gestionadas de forma nativa (requisito 4.1). Limitación conocida y aceptada para este caso de uso: los servicios del plan gratuito entran en *cold start* tras ~15 minutos de inactividad (latencia de arranque de hasta ~1 minuto), lo cual es tolerable porque el flujo de escaneo ya es manual, no *always-on*. La base de datos PostgreSQL gratuita de Render tiene una vigencia limitada (expira si no se actualiza a un plan pago); debe monitorearse o presupuestarse su renovación si se usa ese servicio administrado en vez de SQLite. |
| Frontend hosting | Cloudflare Pages | Coherencia operativa con el resto del portafolio del usuario; plan gratuito suficiente para este volumen de tráfico. |

**Corrección respecto de la versión anterior de este documento:** se descarta Fly.io como opción de backend. Se verificó que Fly.io eliminó su capa gratuita permanente en 2024; actualmente solo ofrece una prueba de 2 horas o 7 días, tras la cual todo el cómputo se factura (~USD 2-5/mes como piso realista). Render Hobby es la opción con costo verificado de $0/mes para este proyecto, sujeta a la limitación de vigencia de su base de datos gratuita señalada arriba.

**Advertencia de rigor persistente:** la elección de proveedor no es una decisión técnicamente única; es una recomendación razonada según costo, coherencia con el entorno existente del usuario y soporte de contenedores. Alternativas equivalentes (Railway, VPS propio con Docker Compose) siguen siendo válidas y no fueron descartadas por ningún defecto técnico, solo no fueron seleccionadas como opción por defecto.

### 3.4.5. Gestión de contingencias (aplicado a cada modo de falla identificado por el usuario)

| Escenario | Mecanismo de mitigación |
|---|---|
| **La API de MAL cae o cambia sus reglas** | Cliente HTTP con reintentos exponenciales acotados (máx. 3) y *circuit breaker*: tras fallos consecutivos, el `ScanRun`/confirmación se marca `error_proveedor` sin bloquear el resto de las entradas. El cliente MAL se aísla en un módulo único para minimizar el radio de impacto de cambios de contrato de la API. |
| **AnimeAV1 cae o es eliminado** | El extractor reporta error por entrada individual, no aborta el `ScanRun` completo. El módulo de extracción se define detrás de una interfaz (`ISourceProvider`) para permitir, en el futuro, agregar una fuente alternativa sin rediseñar el resto del sistema — **no se implementa una segunda fuente en esta versión**, solo se deja el punto de extensión. |
| **El sitio migra a renderizado dinámico (SPA) sin SSR** | Mismo punto de extensión anterior: sustitución del adaptador de `cheerio` por uno basado en navegador headless (Playwright), sin cambios en el contrato del subsistema de extracción. |
| **Un anime entra en hiatus (pausa)** | Campo `status: "hiatus"` en la `Watchlist Config`; el escaneo omite estas entradas o las reporta como `sin_novedad` sin generar advertencia de error. |
| **El usuario abandona (drop) un anime** | Campo `status: "dropped"`; excluido del escaneo. Opcionalmente, el usuario puede solicitar que la confirmación también actualice el estado en MAL a `dropped`, pero esto requiere una acción explícita separada, nunca implícita. |
| **Discrepancia de título AnimeAV1 ↔ MAL** | Tabla de mapeo manual `título_sitio → mal_anime_id`, editable desde la UI. Si el escaneo no encuentra un slug coincidente para una entrada activa, se reporta como `advertencia: mapeo no resuelto`, nunca se omite silenciosamente. |
| **Salto de episodios detectado (episodio_encontrado − episodio_actual > 1)** | Se marca la entrada como `advertencia` en el reporte (no error), forzando revisión visual explícita antes de permitir su confirmación individual, en lugar de auto-aprobarla. |
| **Episodio detectado menor al registrado en MAL** | Se marca como `advertencia: valor_regresivo`; requiere confirmación explícita adicional, ya que puede indicar un error de mapeo o un reinicio de numeración del sitio fuente. |

### 3.4.6. Principios de seguridad aplicados (obligatorios, requisito 4)

- **4.1 Gestión de secretos:** `MAL_CLIENT_ID`, `TOKEN_ENCRYPTION_KEY`, cadena de conexión de base de datos y cualquier credencial se consumen exclusivamente vía variables de entorno (`process.env`). Los tokens OAuth de cada usuario (access/refresh) se almacenan cifrados en reposo (AES-256-GCM) con clave provista por entorno, nunca en texto plano ni en el cliente. Toda llamada a la API de MAL ocurre desde el backend, nunca desde el navegador del usuario.
- **4.2 Sanitización de entradas:** la edición de la `Watchlist Config` desde la UI (JSON) se valida contra un esquema estricto (tipos, longitud máxima de strings, enumeración cerrada de valores de `status`) antes de persistirse, mediante validación de esquema en el backend (p. ej. Zod). Ningún valor de entrada se interpola directamente en consultas SQL (uso de ORM/consultas parametrizadas) ni se refleja sin escapar en la UI.
- **4.3 Autenticación delegada:** la autenticación contra MAL usa el propio proveedor OAuth2/PKCE de MAL, sin gestión manual de contraseñas de terceros. La autenticación de acceso a la app (API key por usuario) es deliberadamente simple porque no gestiona identidad de terceros, solo aislamiento de datos entre el usuario y su amigo; se recomienda evaluar Clerk/Supabase Auth únicamente si el número de usuarios crece más allá del uso personal previsto.
- **4.4 Control de tráfico:** *rate limiting* a nivel de middleware en todos los endpoints del backend (límite por API key), particularmente sobre el endpoint de escaneo (evita disparar cargas repetidas sobre AnimeAV1 en corto tiempo, protegiendo también la relación con el sitio fuente) y sobre el endpoint de confirmación (evita agotar cuota de la API de MAL).

## 3.5. Diseño de Datos

### 3.5.1. Entidades principales

**`User`**
| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID (PK) | |
| `display_name` | string | |
| `api_key_hash` | string | hash de la API key propia del usuario, nunca el valor en claro |
| `mal_access_token_enc` | bytes | cifrado en reposo |
| `mal_refresh_token_enc` | bytes | cifrado en reposo |
| `mal_token_expires_at` | timestamp | |
| `created_at` | timestamp | |

**`WatchlistItem`** (una fila por título seguido, por temporada, por usuario)
| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID (PK) | |
| `user_id` | UUID (FK → User) | |
| `season_label` | string | ej. `"2026-summer"`, editable, permite reutilizar el sistema entre temporadas |
| `site_title` | string | título/slug tal como aparece en AnimeAV1 |
| `mal_anime_id` | integer | resultado del mapeo manual |
| `current_episode` | integer | definido manualmente por el usuario, no inferido |
| `status` | enum(`watching`,`hiatus`,`dropped`) | |
| `updated_at` | timestamp | |

**`ScanRun`**
| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID (PK) | |
| `user_id` | UUID (FK) | |
| `started_at` / `finished_at` | timestamp | |
| `status` | enum(`completado`,`completado_con_errores`,`fallo_total`) | |

**`ScanResult`** (una fila por `WatchlistItem` evaluado en un `ScanRun`)
| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID (PK) | |
| `scan_run_id` | UUID (FK) | |
| `watchlist_item_id` | UUID (FK) | |
| `episode_found` | integer nullable | `null` si hubo error de extracción |
| `episode_current_mal` | integer | valor conocido antes del escaneo |
| `outcome` | enum(`ok`,`sin_novedad`,`advertencia`,`error`) | según reglas de §3.4.5 |
| `detail` | string nullable | mensaje de error o advertencia |
| `confirmed` | boolean | si el usuario ya confirmó la escritura |
| `confirmed_at` | timestamp nullable | |

### 3.5.2. Configuración editable como JSON (formato de referencia)

```json
{
  "season_label": "2026-summer",
  "items": [
    {
      "site_title": "yani-neko",
      "mal_anime_id": 12345,
      "current_episode": 6,
      "status": "watching"
    },
    {
      "site_title": "otome-kaijuu-carameliser",
      "mal_anime_id": 23456,
      "current_episode": 7,
      "status": "watching"
    }
  ]
}
```

Este JSON es la representación de intercambio/edición masiva; la persistencia real ocurre en las tablas relacionales de §3.5.1 para permitir consultas eficientes por estado y por `ScanRun`.

## 3.6. Interfaz de Usuario

### 3.6.1. Principios visuales

- Paleta pastel, modo claro y modo oscuro conmutables (persistidos por preferencia del usuario, no solo por preferencia del sistema operativo).
- PWA instalable: `manifest.json` con iconos en las resoluciones requeridas por Android e íconos de escritorio, `service worker` para funcionamiento con caché de assets estáticos (no se cachea contenido dinámico de escaneo, ya que debe reflejar siempre el estado real).

### 3.6.2. Pantallas principales

1. **Dashboard de temporada:** lista de `WatchlistItem` activos con su `current_episode`, estado y última fecha de escaneo. Botón principal: "Iniciar escaneo".
2. **Reporte de escaneo (Fase A):** tabla con columnas Título / Episodio actual / Episodio detectado / Estado (`ok`, `sin_novedad`, `advertencia`, `error`) / checkbox de selección individual. Filtros rápidos por estado. Botón: "Confirmar actualización de seleccionados" (Fase B), deshabilitado si no hay ninguna fila seleccionada.
3. **Resultado de confirmación:** por cada entrada confirmada, éxito o error devuelto por MAL, con posibilidad de reintento individual.
4. **Configuración de watchlist:** edición de la tabla de mapeo `site_title → mal_anime_id`, alta/baja de títulos, cambio de `status`, edición directa del `current_episode` (para saltos o correcciones manuales), por temporada.
5. **Configuración de cuenta:** estado de la conexión OAuth con MAL (conectado/expirado/no conectado) con botón de reautorización; visualización (no edición posterior) de la API key propia, generada una única vez en el alta del usuario.
6. **Multi-usuario:** cada usuario accede únicamente a su propio dashboard mediante su API key; no existe una vista compartida de datos entre usuarios en esta versión.

### 3.6.3. Retroalimentación al usuario

- Todo estado de error de red (MAL caído, AnimeAV1 caído) se muestra con mensaje explícito del componente afectado, nunca como fallo genérico indiferenciado, para que el usuario pueda distinguir si el problema es de la fuente de datos o del servicio de destino.
- Las advertencias (salto de episodios, mapeo no resuelto, valor regresivo) se muestran visualmente diferenciadas de los errores duros, ya que requieren juicio del usuario, no indican necesariamente una falla del sistema.

---

## Observación final de rigor

Este documento fija el diseño a nivel de arquitectura y datos. No incluye estimaciones de tiempo de desarrollo ni cronograma, por no ser verificables sin datos históricos de velocidad de desarrollo del propio usuario; si se requiere planificación temporal, debe solicitarse como documento separado basado en desglose de tareas concretas.
