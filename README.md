# pixelboard-api — backend de microservicios (gRPC + Connect)

Backend de **Pixelboard**, una pizarra colaborativa de píxeles estilo r/place. Son **tres microservicios independientes** que viven en un **monorepo**: cada uno tiene su propio `package.json`, `Dockerfile` y se despliega como un servicio aparte.

## Arquitectura

~~~text
                    [pixelboard-web]  (Next.js, navegador)
                             │
                             │  protocolo Connect (HTTP/1.1 o HTTP/2)
                             ▼
                    ┌───────────────────┐
                    │  gateway-service  │  ← ÚNICO servicio público
                    │  (BoardService)   │     aplica CORS + delega
                    └─────┬───────┬─────┘
                          │       │
             gRPC (HTTP/2)│       │gRPC (HTTP/2)
              h2c sin TLS │       │
                          ▼       ▼
        ┌──────────────────┐   ┌─────────────────────┐
        │  board-service   │   │ ratelimit-service   │
        │  (StateService)  │   │ (RateLimitService)  │
        │  cuadrícula 50×50│   │ 1 píxel/s/cliente   │
        │  + stream en vivo│   │ ventana en memoria  │
        └──────────────────┘   └─────────────────────┘
~~~

| Servicio | Contrato | Responsabilidad | Estado |
|---|---|---|---|
| `gateway-service` | `board.v1.BoardService` (público) | CORS, resolución de `client_id`, consulta al rate limit, puente del stream | Sin estado de negocio |
| `board-service` | `state.v1.StateService` (interno) | Cuadrícula 50×50 en memoria, validación, suscriptores | En memoria |
| `ratelimit-service` | `ratelimit.v1.RateLimitService` (interno) | 1 píxel/segundo por cliente, limpieza cada 60 s | En memoria |

El navegador **sólo** conoce `board.proto`. Los contratos `state` y `ratelimit` nunca salen del backend.

## Estructura

~~~text
pixelboard-api/
├── proto/
│   ├── board/v1/board.proto          # público: lo implementa el gateway
│   ├── state/v1/state.proto          # interno: lo implementa board-service
│   └── ratelimit/v1/ratelimit.proto  # interno: lo implementa ratelimit-service
├── buf.yaml
├── buf.gen.yaml                      # genera en services/*/src/gen
├── scripts/prune-gen.mjs             # deja en cada servicio sólo sus contratos
├── services/
│   ├── gateway-service/              # src/{server,service,clients,cors}.ts
│   ├── board-service/                # src/{server,service,state,auth}.ts
│   └── ratelimit-service/            # src/{server,service,limiter,auth}.ts
├── docker-compose.yml                # SOLO desarrollo local
├── package.json                      # scripts raíz (workspaces npm)
└── README.md
~~~

Cada servicio incluye `package.json`, `tsconfig.json`, `Dockerfile`, `.dockerignore` y `.env.example`.

## Requisitos

- **Node.js ≥ 20.6** (probado con Node 24).
- **npm ≥ 10** (con npm 11 ver la nota de `allowScripts` más abajo).
- **Docker** (opcional, para el compose local).
- **gcloud CLI** (sólo para desplegar en Cloud Run).

## Instalación

~~~bash
git clone <url-de-pixelboard-api>
cd pixelboard-api
npm install
~~~

> **npm 11 — scripts de instalación.** npm 11 no ejecuta los `postinstall` de las dependencias hasta que se aprueban. `@bufbuild/buf` (descarga el binario `buf`) y `esbuild` (lo usa `tsx`) los necesitan. El `package.json` ya incluye el bloque `allowScripts` con las versiones aprobadas; si al instalar aparece el aviso `install-scripts`, ejecuta:
>
> ~~~bash
> npm install-scripts approve @bufbuild/buf esbuild
> npm install
> ~~~

## Generación de código (buf)

El código TypeScript se genera con **protoc-gen-es v2** a partir de los `.proto`:

~~~bash
npm run generate     # buf generate + poda de src/gen por servicio
~~~

Qué hace exactamente:

1. `buf generate` usa `buf.gen.yaml` y genera **los tres contratos** en `services/*/src/gen`.
2. El script `postgenerate` (`scripts/prune-gen.mjs`, npm lo ejecuta solo después de `generate`) borra lo que no toca:
   - `gateway-service` → `board`, `state` y `ratelimit`
   - `board-service` → `board` y `state`
   - `ratelimit-service` → `ratelimit`
3. Los imports generados llevan extensión `.js` (`import_extension=js`) porque el backend es **ESM nativo** (`"type": "module"` + `moduleResolution: NodeNext`).

**El código generado se commitea** (`src/gen` está en el repo, no en `.gitignore`). Es lo que permite que el contexto de build de Docker sea sólo la carpeta del servicio (ver más abajo).

## Ejecución local

### Opción A — Docker Compose (recomendada)

~~~bash
npm run generate        # imprescindible: el Dockerfile copia src/gen
docker compose up --build
~~~

- Sólo el **gateway** publica puerto al host: `http://localhost:8080`.
- `board` y `ratelimit` quedan en la red interna `pixelboard` con los nombres `board` y `ratelimit`.

### Opción B — sin Docker (concurrently + tsx)

~~~bash
npm install
npm run generate
npm run dev
~~~

`npm run dev` arranca los tres a la vez con `concurrently` y **puertos distintos en local** para que no choquen:

| Servicio | Puerto local | URL |
|---|---|---|
| gateway-service | `8080` | `http://localhost:8080` |
| board-service | `8081` | `http://localhost:8081` |
| ratelimit-service | `8082` | `http://localhost:8082` |

Los defaults del código ya son esos (`BOARD_SERVICE_URL=http://localhost:8081`, `RATELIMIT_SERVICE_URL=http://localhost:8082`) y la clave interna por defecto es `dev-internal-key`.

## Variables de entorno

### gateway-service

| Variable | Por defecto | Descripción |
|---|---|---|
| `PORT` | `8080` | Puerto HTTP. Cloud Run lo inyecta. |
| `ALLOWED_ORIGIN` | `*` | Origen(es) CORS. `*` o lista separada por comas. |
| `BOARD_SERVICE_URL` | `http://localhost:8081` | URL base del board-service. |
| `RATELIMIT_SERVICE_URL` | `http://localhost:8082` | URL base del ratelimit-service. |
| `INTERNAL_API_KEY` | `dev-internal-key` (sólo fuera de producción) | Valor de la cabecera `x-internal-key`. |
| `INTERNAL_PROTOCOL` | `grpc` | `grpc` (HTTP/2 h2c) o `connect` (HTTP/1.1, para Render). |

### board-service / ratelimit-service

| Variable | Por defecto | Descripción |
|---|---|---|
| `PORT` | `8080` | Puerto HTTP (en local usa 8081/8082). |
| `INTERNAL_API_KEY` | `dev-internal-key` (sólo fuera de producción) | Clave exigida en `x-internal-key`. Si está vacía, se rechaza todo (`Unauthenticated`). |

Ambos exponen `GET /health` → `200 ok`.

## Detalles de implementación que conviene conocer

### HTTP/2 (h2c) y HTTP/1.1 en el mismo puerto
Todos los servicios escuchan **h2c sin TLS** con `node:http2` (la plataforma termina TLS por fuera). Como `http2.createServer()` de Node **no** admite `allowHTTP1` (esa opción sólo existe con TLS), cada `server.ts` incluye un pequeño listener propio (`listenDualProtocol`): un `net.Server` lee el primer paquete, detecta el prefacio HTTP/2 (`PRI * HTTP/2.0`) y entrega el socket al servidor http2 o al servidor HTTP/1.1.

Así, gRPC/Connect siguen usando HTTP/2 y, además, `curl http://localhost:8080/health` funciona sin flags.

### Cliente interno
`clients.ts` crea los clientes con `createGrpcTransport` (gRPC nativo sobre HTTP/2). En Connect v2 esa función **ya implica HTTP/2**, así que no existe la opción `httpVersion`. Un `Interceptor` añade `x-internal-key` en todas las llamadas y los unary llevan `timeoutMs: 3000`.

### Fail-open del rate limit
Si `ratelimit-service` no responde, `PaintPixel` **permite** la petición y escribe el error en consola. Es preferible que la pizarra siga viva a que un servicio auxiliar caído bloquee todo.

### Cancelación del stream
`WatchBoard` reenvía `context.signal` (el `AbortSignal` del cliente) a `StateService.WatchPixels`. Cuando el navegador se desconecta, el stream interno se cancela y `board-service` ejecuta su `finally`: quita el listener de `abort` y **desuscribe** el callback. Sin eso, cada visitante desconectado dejaría un suscriptor vivo.

### Seguridad entre servicios
`board-service` y `ratelimit-service` exigen la cabecera `x-internal-key` mediante un **interceptor de Connect** (`auth.ts`). Si falta o no coincide → `Unauthenticated`. El gateway la añade con un interceptor de cliente.

## Docker

Cada servicio tiene su propio `Dockerfile` multi-stage (build con Node + runtime ligero, **usuario no root**, `EXPOSE 8080`).

**Contexto de build = la carpeta del servicio** (`services/<servicio>`), que es justo lo que usa `gcloud run deploy --source services/<servicio>`.

> **Opción elegida para el código generado:** se genera en local/CI con `npm run generate` y **se commitea** en `src/gen`. El `Dockerfile` sólo copia `package.json`, `tsconfig.json` y `src` (que ya incluye `src/gen`). Así el contexto es autocontenido y la imagen no necesita `buf` ni la carpeta `proto/`.
>
> La alternativa (copiar `proto/` al contexto y ejecutar `buf generate` dentro de la imagen) obliga a subir el monorepo entero en cada build y a instalar el CLI de buf en la imagen; no compensa para una demo.

~~~bash
docker build -t pixelboard-board services/board-service
docker run -p 8080:8080 -e INTERNAL_API_KEY=dev-internal-key pixelboard-board
~~~

## Despliegue en Google Cloud Run

Tres servicios independientes, **HTTP/2 end-to-end** con `--use-http2`.

~~~bash
PROJECT_ID=mi-proyecto
REGION=us-central1
INTERNAL_API_KEY="$(openssl rand -hex 24)"

gcloud config set project "$PROJECT_ID"

# 1) ratelimit-service
gcloud run deploy pixelboard-ratelimit \
  --source services/ratelimit-service \
  --region "$REGION" \
  --allow-unauthenticated \
  --use-http2 \
  --max-instances=1 \
  --set-env-vars "INTERNAL_API_KEY=$INTERNAL_API_KEY"

# 2) board-service  (¡max-instances=1 obligatorio!)
gcloud run deploy pixelboard-board \
  --source services/board-service \
  --region "$REGION" \
  --allow-unauthenticated \
  --use-http2 \
  --max-instances=1 \
  --set-env-vars "INTERNAL_API_KEY=$INTERNAL_API_KEY"

# 3) Copiar URLs
BOARD_URL=$(gcloud run services describe pixelboard-board --region "$REGION" --format='value(status.url)')
RATELIMIT_URL=$(gcloud run services describe pixelboard-ratelimit --region "$REGION" --format='value(status.url)')

# 4) gateway-service (ALLOWED_ORIGIN provisional; se corrige al final)
gcloud run deploy pixelboard-gateway \
  --source services/gateway-service \
  --region "$REGION" \
  --allow-unauthenticated \
  --use-http2 \
  --max-instances=2 \
  --set-env-vars "INTERNAL_API_KEY=$INTERNAL_API_KEY,BOARD_SERVICE_URL=$BOARD_URL,RATELIMIT_SERVICE_URL=$RATELIMIT_URL,ALLOWED_ORIGIN=https://pixelboard.vercel.app"
~~~

Después: desplegar `pixelboard-web` en Vercel con `NEXT_PUBLIC_API_URL` apuntando a la URL del gateway y, por último, actualizar `ALLOWED_ORIGIN` del gateway con el dominio real de Vercel:

~~~bash
gcloud run services update pixelboard-gateway --region "$REGION" \
  --update-env-vars ALLOWED_ORIGIN=https://tu-app.vercel.app
~~~

### ¿Por qué `--max-instances=1` en board-service?

La cuadrícula y la lista de suscriptores viven **en memoria del proceso**. Con dos instancias habría dos cuadrículas distintas y dos streams independientes: un usuario vería sólo la mitad de los píxeles. Por eso:

- `pixelboard-board` → **`--max-instances=1`** (obligatorio en esta demo).
- `pixelboard-ratelimit` → también 1 instancia, porque el contador es en memoria.
- `pixelboard-gateway` → sin estado, puede escalar; se deja en 2 para mostrar que escala.

**En producción** esto se resolvería con **Redis**: la cuadrícula en un hash y **Pub/Sub de Redis** para el fan-out del stream a todas las instancias (`board-service` sería horizontalmente escalable). Está listado en *Ideas futuras*.

> `--allow-unauthenticated` en los servicios internos no los protege: hoy los protege la cabecera `x-internal-key`. Para producción de verdad, ver *Ideas futuras* (IAM de Cloud Run con tokens de identidad).

### Orden de despliegue (resumen)

1. `pixelboard-ratelimit` y `pixelboard-board` → copiar sus URLs.
2. `pixelboard-gateway` con `BOARD_SERVICE_URL`, `RATELIMIT_SERVICE_URL`, `INTERNAL_API_KEY` y un `ALLOWED_ORIGIN` provisional.
3. `pixelboard-web` en Vercel con `NEXT_PUBLIC_API_URL` = URL del gateway.
4. Actualizar `ALLOWED_ORIGIN` del gateway con el dominio de Vercel.

## Despliegue en Render

### 0) Sube el repositorio a GitHub

Render despliega desde Git. Desde `pixelboard-api`:

```bash
git init && git add . && git commit -m "pixelboard-api"
git branch -M main
git remote add origin https://github.com/<tu-usuario>/pixelboard-api.git
git push -u origin main
```

> El código generado (`services/*/src/gen`) **está en el repo a propósito**: el contexto de build de Docker es sólo `services/<servicio>`, así que la imagen no puede ejecutar `buf`.

### 1) Opción A — Blueprint (recomendado, un solo paso)

El repo incluye `render.yaml`. En el dashboard de Render:

**New → Blueprint → conecta el repositorio `pixelboard-api`**

Render crea los tres servicios y rellena solo:

- `INTERNAL_API_KEY` (la genera y la comparte con el gateway vía `fromService`).
- `BOARD_SERVICE_URL` y `RATELIMIT_SERVICE_URL` (desde `RENDER_EXTERNAL_URL`).
- `INTERNAL_PROTOCOL=connect`.

Lo único que te pedirá es **`ALLOWED_ORIGIN`**, donde va el dominio de Vercel:

```text
https://pixelboard.vercel.app,https://pixelboard-*.vercel.app
```

### 2) Opción B — manual (3 Web Services)

**New → Web Service**, conecta el repo y repite para cada servicio:

| Ajuste | gateway | board | ratelimit |
|---|---|---|---|
| Name | `pixelboard-gateway` | `pixelboard-board` | `pixelboard-ratelimit` |
| Language / Runtime | **Docker** | **Docker** | **Docker** |
| Root Directory | `services/gateway-service` | `services/board-service` | `services/ratelimit-service` |
| Dockerfile Path | `./Dockerfile` | `./Dockerfile` | `./Dockerfile` |
| Health Check Path | `/health` | `/health` | `/health` |
| Instance Type | Free | Free | Free |
| Region | **la misma en los tres** | | |

Variables de entorno:

```text
# board-service y ratelimit-service
INTERNAL_API_KEY = <cadena aleatoria larga, LA MISMA en los tres>
```

```text
# gateway-service
INTERNAL_API_KEY      = <la misma>
BOARD_SERVICE_URL     = https://pixelboard-board.onrender.com
RATELIMIT_SERVICE_URL = https://pixelboard-ratelimit.onrender.com
INTERNAL_PROTOCOL     = connect
ALLOWED_ORIGIN        = https://pixelboard.vercel.app,https://pixelboard-*.vercel.app
```

> Copia la URL que Render muestra arriba del servicio (**no** le añadas `:8080`). Render inyecta `PORT` y el código ya lo respeta.

### Las 4 diferencias con Cloud Run

1. **No hay h2c hasta el contenedor.** Render termina TLS y habla **HTTP/1.1** con tu servicio, así que `createGrpcTransport` (gRPC sobre HTTP/2) no atraviesa. Por eso el gateway va con **`INTERNAL_PROTOCOL=connect`**: usa el protocolo Connect por HTTP/1.1 y el resto del código no cambia. *(Si algún día tienes h2c de verdad, basta con quitar esa variable.)*
2. **Sin `--use-http2` ni `--max-instances`.** El equivalente a `max-instances=1` es **Scaling → Instance Count = 1** en `board` y `ratelimit` (en el plan Free ya es 1).
3. **Red interna opcional.** Con el plan Free usa las URLs públicas + `x-internal-key` (funciona siempre). En planes de pago puedes usar la red privada cambiando `BOARD_SERVICE_URL` por `http://pixelboard-board:10000`.
4. **Cold starts del plan Free.** El servicio se duerme a los ~15 min de inactividad y la primera petición tarda ~30-60 s. Ver *Problemas comunes*.

> **Importante:** `INTERNAL_API_KEY` debe ser **idéntica** en los tres servicios. Si la cambias en uno, cámbiala en los tres.

### Comprobación (desde tu máquina)

```bash
curl -s https://pixelboard-gateway.onrender.com/health
# -> ok
```

## Pruebas con `buf curl` y `curl`

Todo se ejecuta desde la raíz de `pixelboard-api` (los comandos necesitan `--schema proto`).

### 1) Servicios internos (gRPC sobre h2c, requieren `x-internal-key`)

~~~bash
# board-service: estado actual
npx --no-install buf curl --schema proto --protocol grpc --http2-prior-knowledge \
  -H "x-internal-key: dev-internal-key" -d '{}' \
  http://localhost:8081/state.v1.StateService/GetSnapshot

# board-service: pintar (válido)
npx --no-install buf curl --schema proto --protocol grpc --http2-prior-knowledge \
  -H "x-internal-key: dev-internal-key" \
  -d '{"pixel":{"x":1,"y":2,"color":"#FF0000"}}' \
  http://localhost:8081/state.v1.StateService/ApplyPixel

# board-service: coordenada inválida -> InvalidArgument
npx --no-install buf curl --schema proto --protocol grpc --http2-prior-knowledge \
  -H "x-internal-key: dev-internal-key" \
  -d '{"pixel":{"x":99,"y":2,"color":"#FF0000"}}' \
  http://localhost:8081/state.v1.StateService/ApplyPixel

# board-service: sin clave -> Unauthenticated
npx --no-install buf curl --schema proto --protocol grpc --http2-prior-knowledge \
  -d '{}' http://localhost:8081/state.v1.StateService/GetSnapshot

# board-service: stream en vivo (Ctrl+C para salir)
npx --no-install buf curl --schema proto --protocol grpc --http2-prior-knowledge \
  -H "x-internal-key: dev-internal-key" \
  http://localhost:8081/state.v1.StateService/WatchPixels

# ratelimit-service: 1ª llamada allowed=true, 2ª (en <1 s) allowed=false
npx --no-install buf curl --schema proto --protocol grpc --http2-prior-knowledge \
  -H "x-internal-key: dev-internal-key" -d '{"clientId":"9.9.9.9"}' \
  http://localhost:8082/ratelimit.v1.RateLimitService/Check
~~~

En **Windows PowerShell** el JSON con comillas dobles hay que pasarlo desde fichero:

~~~powershell
Set-Content tmp/apply.json '{"pixel":{"x":1,"y":2,"color":"#FF0000"}}'
npx --no-install buf curl --schema proto --protocol grpc --http2-prior-knowledge -H "x-internal-key: dev-internal-key" -d "@tmp/apply.json" http://localhost:8081/state.v1.StateService/ApplyPixel
~~~

### 2) Gateway (protocolo Connect, igual que el navegador)

~~~bash
# GetBoard
npx --no-install buf curl --schema proto -d '{}' \
  http://localhost:8080/board.v1.BoardService/GetBoard

# WatchBoard (stream en vivo)
npx --no-install buf curl --schema proto \
  http://localhost:8080/board.v1.BoardService/WatchBoard

# PaintPixel con curl puro (Connect = POST + JSON)
curl -s -i -X POST http://localhost:8080/board.v1.BoardService/PaintPixel \
  -H "Content-Type: application/json" \
  -H "Connect-Protocol-Version: 1" \
  -H "X-Forwarded-For: 203.0.113.7" \
  -d '{"pixel":{"x":10,"y":10,"color":"#00AA00"}}'

# Segunda pintada inmediata del MISMO cliente -> 429 resource_exhausted
curl -s -i -X POST http://localhost:8080/board.v1.BoardService/PaintPixel \
  -H "Content-Type: application/json" \
  -H "Connect-Protocol-Version: 1" \
  -H "X-Forwarded-For: 203.0.113.7" \
  -d '{"pixel":{"x":11,"y":10,"color":"#0000FF"}}'

# Preflight CORS
curl -s -i -X OPTIONS http://localhost:8080/board.v1.BoardService/PaintPixel \
  -H "Origin: http://localhost:3000" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: connect-protocol-version,content-type"

# Health (HTTP/1.1 y HTTP/2)
curl -s http://localhost:8080/health
~~~

## Problemas comunes

| Síntoma | Causa | Solución |
|---|---|---|
| El navegador dice `blocked by CORS policy` | `ALLOWED_ORIGIN` no incluye el origen real (con `https://` y **sin** barra final) | Ajustar la variable y reiniciar/redesplegar el gateway. Comprobar el preflight con el `curl -X OPTIONS` de arriba. |
| El stream se corta a los 30–60 s | Un proxy intermedio cierra conexiones inactivas | El frontend reconecta con espera creciente; subir el timeout del proxy (Cloud Run admite hasta 60 min con `--timeout`). |
| `ERR_PACKAGE_PATH_NOT_EXPORTED` / `Cannot find module './x_pb'` | Código generado antiguo o `import_extension` incorrecto | Ejecutar `npm run generate` y recompilar. Los imports del backend llevan `.js`; los del frontend, no. |
| `http2: Transport received GOAWAY` contra un servicio interno | El contenedor no habla h2c (p. ej. Render termina HTTP/1.1) | Poner `INTERNAL_PROTOCOL=connect` en el gateway. |
| `Unavailable: connect ECONNREFUSED` hacia un servicio interno | URL interna mal puesta o el servicio no está listo | En Cloud Run usar la URL `https://…run.app`; en compose, `http://board:8080`; en local, `http://localhost:8081`. |
| `Unauthenticated: cabecera x-internal-key ausente o incorrecta` | `INTERNAL_API_KEY` distinta entre gateway y servicio interno, o vacía | Usar **el mismo valor** en los tres servicios. En producción, si falta, el servicio rechaza todo a propósito. |
| El píxel pintado desaparece al recargar | `board-service` con más de una instancia | `--max-instances=1`. Es la limitación del estado en memoria. |
| `npm error … install-scripts` con npm 11 | Los `postinstall` no están aprobados | `npm install-scripts approve @bufbuild/buf esbuild` y reinstalar. |
| Primera petición muy lenta (cold start) | Cloud Run/Render arrancan el contenedor desde cero | `--min-instances=1` (tiene coste) o asumir que la primera llamada tarda unos segundos. |
| `curl http://localhost:8080/health` falla | Se ha tocado el listener dual | Probar con `curl --http2-prior-knowledge` y revisar `listenDualProtocol`. |

## Ideas futuras

- **Redis** como estado compartido (hash `board` + Pub/Sub para el fan-out del stream) → `board-service` escalable horizontalmente.
- **IAM de Cloud Run con tokens de identidad** en lugar de `x-internal-key`: cada servicio exige un token verificado (`--no-allow-unauthenticated` + `idtoken` en el cliente). Es la alternativa robusta a la clave compartida.
- Persistencia histórica (BigQuery / Postgres) y replay de la cuadrícula.
- Rate limit distribuido (Redis + ventana deslizante real) en vez de en memoria.
- Autenticación de usuarios y moderación de contenido.
- `buf breaking` en CI contra la rama principal para no romper contratos.
- Observabilidad: OpenTelemetry + Cloud Trace.