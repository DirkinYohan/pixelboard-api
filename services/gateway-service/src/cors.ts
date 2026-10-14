import type { IncomingMessage, ServerResponse } from "node:http";
import type { Http2ServerRequest, Http2ServerResponse } from "node:http2";

export type GatewayRequest = IncomingMessage | Http2ServerRequest;
export type GatewayResponse = ServerResponse | Http2ServerResponse;
export type GatewayHandler = (request: GatewayRequest, response: GatewayResponse) => void;

/** Cabeceras que el navegador envía en las llamadas Connect (necesarias en el preflight). */
const ALLOWED_REQUEST_HEADERS = [
  "Connect-Protocol-Version",
  "Connect-Timeout-Ms",
  "Content-Type",
  "X-Grpc-Web",
  "X-User-Agent",
].join(", ");

/** Cabeceras de Connect que el navegador debe poder leer. */
const EXPOSED_RESPONSE_HEADERS = [
  "Connect-Protocol-Version",
  "Grpc-Status",
  "Grpc-Message",
  "Grpc-Status-Details-Bin",
].join(", ");

/**
 * Compara un origen con un patrón de ALLOWED_ORIGIN.
 * Acepta coincidencia exacta y un comodín, p. ej. `https://pixelboard-*.vercel.app`
 * (imprescindible para que funcionen los dominios de preview de Vercel).
 */
function matchesOrigin(origin: string, pattern: string): boolean {
  if (pattern === "*") return true;
  const wildcardAt = pattern.indexOf("*");
  if (wildcardAt === -1) return pattern === origin;
  const prefix = pattern.slice(0, wildcardAt);
  const suffix = pattern.slice(wildcardAt + 1);
  return (
    origin.length >= prefix.length + suffix.length &&
    origin.startsWith(prefix) &&
    origin.endsWith(suffix)
  );
}

/** ALLOWED_ORIGIN admite "*", comodines y una lista separada por comas. */
export function isOriginAllowed(origin: string, allowedOrigin: string): boolean {
  const patterns = allowedOrigin
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value !== "");
  return patterns.some((pattern) => matchesOrigin(origin, pattern));
}

function writePlainText(response: GatewayResponse, statusCode: number, body: string): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "text/plain; charset=utf-8");
  response.end(body);
}

/** Añade CORS a cualquier handler de Connect y gestiona OPTIONS y /health. */
export function withCors(handler: GatewayHandler, allowedOrigin: string): GatewayHandler {
  return (request, response) => {
    const origin = request.headers.origin;
    const originAllowed = typeof origin === "string" && isOriginAllowed(origin, allowedOrigin);

    if (originAllowed) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");
      response.setHeader("Access-Control-Expose-Headers", EXPOSED_RESPONSE_HEADERS);
    } else if (allowedOrigin.trim() === "*") {
      response.setHeader("Access-Control-Allow-Origin", "*");
    }

    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
      response.setHeader("Access-Control-Allow-Headers", ALLOWED_REQUEST_HEADERS);
      response.setHeader("Access-Control-Max-Age", "86400");
      response.end();
      return;
    }

    if (request.url === "/health" || request.url === "/healthz") {
      writePlainText(response, 200, "ok");
      return;
    }

    handler(request, response);
  };
}
