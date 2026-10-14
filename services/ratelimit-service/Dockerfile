# syntax=docker/dockerfile:1
# Contexto de build = ESTA carpeta del servicio (services/ratelimit-service), que es lo que
# usa `gcloud run deploy --source services/ratelimit-service`.
#
# OPCIÓN ELEGIDA para el código generado: se genera en local/CI (`npm run generate`)
# y se COMMITEA en `src/gen`. Así el contexto de build es autocontenido y no hace
# falta subir la carpeta `proto/` ni instalar buf dentro de la imagen.

# ---------- build ----------
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json ./
RUN npm install --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------- runtime ----------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY --from=build /app/dist ./dist

# Usuario no root (ya existe en la imagen oficial de Node).
USER node

EXPOSE 8080
CMD ["node", "dist/server.js"]
