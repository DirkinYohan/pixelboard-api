import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createContextKey, type ServiceImpl } from "@connectrpc/connect";

import { rateLimitClient, stateClient, UNARY_TIMEOUT_MS } from "./clients.js";
import {
  type BoardService,
  GetBoardResponseSchema,
  PaintPixelResponseSchema,
} from "./gen/board/v1/board_pb.js";

/** IP del socket inyectada por server.ts en los valores de contexto. */
export const remoteAddressKey = createContextKey("", {
  description: "Dirección IP del socket que realiza la petición",
});

/**
 * client_id = primera IP de X-Forwarded-For (lo que ve el balanceador) o, si no
 * existe, la IP del socket de la conexión.
 */
export function clientIdFrom(requestHeader: Headers, remoteAddress: string): string {
  const forwarded = requestHeader.get("x-forwarded-for");
  if (forwarded !== null) {
    const first = forwarded.split(",")[0]?.trim();
    if (first !== undefined && first !== "") return first;
  }
  return remoteAddress !== "" ? remoteAddress : "unknown";
}

export const boardService: ServiceImpl<typeof BoardService> = {
  async getBoard(_request, _context) {
    const snapshot = await stateClient.getSnapshot({}, { timeoutMs: UNARY_TIMEOUT_MS });
    return create(GetBoardResponseSchema, { pixels: snapshot.pixels });
  },

  async paintPixel(request, context) {
    const pixel = request.pixel;
    if (pixel === undefined) {
      throw new ConnectError("Falta el píxel a pintar", Code.InvalidArgument);
    }

    const clientId = clientIdFrom(context.requestHeader, context.values.get(remoteAddressKey));

    let allowed = true;
    let retryAfterMs = 0;
    try {
      const decision = await rateLimitClient.check({ clientId }, { timeoutMs: UNARY_TIMEOUT_MS });
      allowed = decision.allowed;
      retryAfterMs = decision.retryAfterMs;
    } catch (error) {
      // Fail-open: si el servicio de límites no responde, se permite pintar.
      console.error("[gateway] ratelimit-service no disponible; se permite la petición:", error);
      allowed = true;
    }

    if (!allowed) {
      throw new ConnectError(
        "Has pintado demasiado rápido. Reintenta en " + String(retryAfterMs) + " ms.",
        Code.ResourceExhausted,
      );
    }

    await stateClient.applyPixel({ pixel }, { timeoutMs: UNARY_TIMEOUT_MS });
    return create(PaintPixelResponseSchema, {});
  },

  async *watchBoard(_request, context) {
    // context.signal se aborta cuando el navegador se desconecta; ese mismo signal
    // viaja al board-service y cancela el stream interno (sin suscriptores colgados).
    const pixels = stateClient.watchPixels({}, { signal: context.signal });
    for await (const pixel of pixels) {
      yield pixel;
    }
  },
};
