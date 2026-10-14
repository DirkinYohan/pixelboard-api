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

/** ALLOWED_ORIGIN admite "*" o una lista de orígenes separada por comas. */
export function isOriginAllowed(origin: string, allowedOrigin: string): boolean {
  if (allowedOrigin.trim() === "*") return true;
  return allowedOrigin
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value !== "")
    .includes(origin);
}

/** Responde al preflight y responde 200 a /health (antes de llegar a Connect). */
function writePlainText(response: GatewayResponse, statusCode: number, body: string): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "text/plain; charset=utf-8");
  response.end(body);
}

/** Añade CORS a cualquier handler de Connect y gestiona OPTIONS. */
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
