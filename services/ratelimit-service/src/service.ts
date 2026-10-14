import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, type ServiceImpl } from "@connectrpc/connect";

import { CheckResponseSchema, type RateLimitService } from "./gen/ratelimit/v1/ratelimit_pb.js";
import { clientRateLimiter } from "./limiter.js";

export const rateLimitService: ServiceImpl<typeof RateLimitService> = {
  async check(request, _context) {
    const clientId = request.clientId.trim();
    if (clientId === "") {
      throw new ConnectError("client_id es obligatorio", Code.InvalidArgument);
    }
    const decision = clientRateLimiter.check(clientId);
    return create(CheckResponseSchema, {
      allowed: decision.allowed,
      retryAfterMs: decision.retryAfterMs,
    });
  },
};
