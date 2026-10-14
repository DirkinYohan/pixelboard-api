import { create } from "@bufbuild/protobuf";

import { PixelSchema, type Pixel } from "./gen/board/v1/board_pb.js";

export const BOARD_WIDTH = 50;
export const BOARD_HEIGHT = 50;
export const DEFAULT_COLOR = "#FFFFFF";

type PixelSubscriber = (pixel: Pixel) => void;

/**
 * Estado de la cuadrícula en memoria (sin base de datos) + suscriptores del stream.
 * Por eso board-service debe desplegarse con una sola instancia.
 */
export class BoardState {
  private readonly cells: string[];
  private readonly subscribers = new Set<PixelSubscriber>();

  constructor() {
    this.cells = new Array<string>(BOARD_WIDTH * BOARD_HEIGHT).fill(DEFAULT_COLOR);
  }

  /** Sólo se devuelven los píxeles que difieren del color inicial. */
  snapshot(): Pixel[] {
    const pixels: Pixel[] = [];
    for (let y = 0; y < BOARD_HEIGHT; y += 1) {
      for (let x = 0; x < BOARD_WIDTH; x += 1) {
        const color = this.cells[y * BOARD_WIDTH + x];
        if (color !== undefined && color !== DEFAULT_COLOR) {
          pixels.push(create(PixelSchema, { x, y, color }));
        }
      }
    }
    return pixels;
  }

  apply(pixel: Pixel): void {
    this.cells[pixel.y * BOARD_WIDTH + pixel.x] = pixel.color;
    for (const subscriber of this.subscribers) {
      subscriber(pixel);
    }
  }

  /** Devuelve la función para darse de baja (se llama al cerrar el stream). */
  subscribe(subscriber: PixelSubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  get subscriberCount(): number {
    return this.subscribers.size;
  }
}

export const boardState = new BoardState();
