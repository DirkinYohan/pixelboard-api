import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, type ServiceImpl } from "@connectrpc/connect";

import { PixelSchema, type Pixel } from "./gen/board/v1/board_pb.js";
import {
  ApplyPixelResponseSchema,
  GetSnapshotResponseSchema,
  type StateService,
} from "./gen/state/v1/state_pb.js";
import { BOARD_HEIGHT, BOARD_WIDTH, boardState } from "./state.js";

const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** Valida coordenadas y color; devuelve el píxel normalizado (color en mayúsculas). */
function validatePixel(pixel: Pixel): Pixel {
  const inRange =
    Number.isInteger(pixel.x) &&
    Number.isInteger(pixel.y) &&
    pixel.x >= 0 &&
    pixel.x < BOARD_WIDTH &&
    pixel.y >= 0 &&
    pixel.y < BOARD_HEIGHT;
  if (!inRange) {
    throw new ConnectError(
      "Coordenadas fuera de rango: x e y deben estar entre 0 y " + String(BOARD_WIDTH - 1),
      Code.InvalidArgument,
    );
  }
  if (!COLOR_PATTERN.test(pixel.color)) {
    throw new ConnectError("Color inválido: se espera el formato #RRGGBB", Code.InvalidArgument);
  }
  return create(PixelSchema, { x: pixel.x, y: pixel.y, color: pixel.color.toUpperCase() });
}

export const stateService: ServiceImpl<typeof StateService> = {
  async getSnapshot(_request, _context) {
    return create(GetSnapshotResponseSchema, { pixels: boardState.snapshot() });
  },

  async applyPixel(request, _context) {
    const pixel = request.pixel;
    if (pixel === undefined) {
      throw new ConnectError("Falta el píxel a aplicar", Code.InvalidArgument);
    }
    boardState.apply(validatePixel(pixel));
    return create(ApplyPixelResponseSchema, {});
  },

  async *watchPixels(_request, context) {
    const queue: Pixel[] = [];
    let wake: (() => void) | undefined;
    let closed = false;

    const notify = (): void => {
      const resolve = wake;
      if (resolve !== undefined) {
        wake = undefined;
        resolve();
      }
    };

    const unsubscribe = boardState.subscribe((pixel) => {
      queue.push(pixel);
      notify();
    });

    const onAbort = (): void => {
      closed = true;
      notify();
    };
    context.signal.addEventListener("abort", onAbort, { once: true });

    try {
      while (!closed) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          continue;
        }
        const next = queue.shift();
        if (next !== undefined) yield next;
      }
    } finally {
      // Imprescindible: sin esto cada cliente desconectado dejaría un suscriptor vivo.
      context.signal.removeEventListener("abort", onAbort);
      unsubscribe();
    }
  },
};
