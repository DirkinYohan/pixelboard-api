import type { Transport } from "@connectrpc/connect";
import { createClient, type Interceptor } from "@connectrpc/connect";
import { createConnectTransport, createGrpcTransport } from "@connectrpc/connect-node";

import { RateLimitService } from "./gen/ratelimit/v1/ratelimit_pb.js";
import { StateService } from "./gen/state/v1/state_pb.js";

/** Timeout por defecto de las llamadas unary a los servicios internos. */
export const UNARY_TIMEOUT_MS = 3000;

const boardServiceUrl = process.env.BOARD_SERVICE_URL ?? "http://localhost:8081";
const rateLimitServiceUrl = process.env.RATELIMIT_SERVICE_URL ?? "http://localhost:8082";
const internalApiKey = process.env.INTERNAL_API_KEY ?? "";

/**
 * Protocolo interno. Por defecto gRPC nativo sobre HTTP/2 (h2c, sin TLS: la
 * plataforma termina TLS por fuera). `INTERNAL_PROTOCOL=connect` usa el protocolo
 * Connect sobre HTTP/1.1 para plataformas que no hablan h2c con el contenedor
 * (por ejemplo Render); el resto del código no cambia.
 */
const internalProtocol = process.env.INTERNAL_PROTOCOL ?? "grpc";

/** Añade la cabecera compartida por todos los servicios internos en cada llamada. */
const internalKeyInterceptor: Interceptor = (next) => async (request) => {
  request.header.set("x-internal-key", internalApiKey);
  return await next(request);
};

function createInternalTransport(baseUrl: string): Transport {
  if (internalProtocol === "connect") {
    return createConnectTransport({
      baseUrl,
      httpVersion: "1.1",
      interceptors: [internalKeyInterceptor],
    });
  }
  // En Connect v2 createGrpcTransport YA implica gRPC sobre HTTP/2 (h2c):
  // no existe la opción httpVersion porque el protocolo la fija.
  return createGrpcTransport({
    baseUrl,
    interceptors: [internalKeyInterceptor],
  });
}

export const stateClient = createClient(StateService, createInternalTransport(boardServiceUrl));
export const rateLimitClient = createClient(
  RateLimitService,
  createInternalTransport(rateLimitServiceUrl),
);
