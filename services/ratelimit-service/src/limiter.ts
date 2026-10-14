export const WINDOW_MS = 1000;
const IDLE_TIMEOUT_MS = 60_000;

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly retryAfterMs: number;
}

/**
 * Ventana simple en memoria: 1 píxel por segundo por client_id.
 * `lastPaintAt` guarda el instante del último píxel permitido; una entrada antigua
 * se considera libre de nuevo, y `prune()` borra las inactivas cada 60 s.
 */
export class ClientRateLimiter {
  private readonly lastPaintAt = new Map<string, number>();

  check(clientId: string, now: number = Date.now()): RateLimitDecision {
    const previous = this.lastPaintAt.get(clientId);
    if (previous !== undefined) {
      const elapsed = now - previous;
      if (elapsed < WINDOW_MS) {
        return { allowed: false, retryAfterMs: WINDOW_MS - elapsed };
      }
    }
    this.lastPaintAt.set(clientId, now);
    return { allowed: true, retryAfterMs: 0 };
  }

  /** Limpieza periódica: devuelve cuántos clientes inactivos se han borrado. */
  prune(now: number = Date.now()): number {
    let removed = 0;
    for (const [clientId, timestamp] of this.lastPaintAt) {
      if (now - timestamp > IDLE_TIMEOUT_MS) {
        this.lastPaintAt.delete(clientId);
        removed += 1;
      }
    }
    return removed;
  }

  get size(): number {
    return this.lastPaintAt.size;
  }
}

export const clientRateLimiter = new ClientRateLimiter();
