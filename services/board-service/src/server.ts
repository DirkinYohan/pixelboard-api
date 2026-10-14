import * as http from "node:http";
import * as http2 from "node:http2";
import * as net from "node:net";

import { connectNodeAdapter } from "@connectrpc/connect-node";

import { internalAuthInterceptor } from "./auth.js";
import { StateService } from "./gen/state/v1/state_pb.js";
import { stateService } from "./service.js";

type NodeRequest = http.IncomingMessage | http2.Http2ServerRequest;
type NodeResponse = http.ServerResponse | http2.Http2ServerResponse;
type NodeHandler = (request: NodeRequest, response: NodeResponse) => void;

/** Prefacio de conexión HTTP/2 (RFC 9113 §3.4). */
const HTTP2_PREFACE = "PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n";

/**
 * Un único puerto que habla h2c (HTTP/2 sin TLS) y HTTP/1.1 a la vez.
 *
 * gRPC/Connect negocian HTTP/2 por "prior knowledge" (envían el prefacio), y los
 * health checks, curl y algunos PaaS entran por HTTP/1.1. node:http2 sólo acepta
 * `allowHTTP1` con TLS, así que repartimos la conexión según el primer byte.
 */
function listenDualProtocol(port: number, handler: NodeHandler, onListening: () => void): void {
  const http1Server = http.createServer(handler);
  const http2Server = http2.createServer(handler);
  const front = net.createServer((socket) => {
    // Ojo: en este momento el socket todavía no pertenece a ningún servidor (la
    // transferencia ocurre al leer el primer paquete). Sin este handler, un
    // ECONNRESET del cliente (cerrar la pestaña, abortar el stream) sería un
    // "error" no capturado y tumbaría el proceso entero.
    socket.on("error", () => {
      socket.destroy();
    });
    socket.once("data", (chunk: Buffer) => {
      socket.pause();
      const isHttp2 =
        chunk.subarray(0, HTTP2_PREFACE.length).toString("latin1") === HTTP2_PREFACE;
      const server = isHttp2 ? http2Server : http1Server;
      // El servidor (http/http2) engancha su parser al recibir "connection";
      // sólo después devolvemos al buffer del socket los bytes ya consumidos aquí.
      server.emit("connection", socket);
      socket.unshift(chunk);
      socket.resume();
    });
  });
  front.listen(port, onListening);
}

const port = Number(process.env.PORT ?? 8080);
const internalApiKey = process.env.INTERNAL_API_KEY ?? "";

if (internalApiKey === "") {
  console.warn("[board] INTERNAL_API_KEY vacía: se rechazarán todas las llamadas internas.");
}

const rpcHandler = connectNodeAdapter({
  routes: (router) => {
    router.service(StateService, stateService, {
      interceptors: [internalAuthInterceptor(internalApiKey, "board-service")],
    });
  },
});

const handler: NodeHandler = (request, response) => {
  if (request.url === "/health" || request.url === "/healthz") {
    response.statusCode = 200;
    response.setHeader("content-type", "text/plain; charset=utf-8");
    response.end("ok");
    return;
  }
  rpcHandler(request, response);
};

listenDualProtocol(port, handler, () => {
  console.log("[board] escuchando en :" + String(port) + " (h2c + http/1.1)");
});
