import { Code, ConnectError, type Interceptor } from "@connectrpc/connect";

/**
 * Interceptor de servidor: exige la cabecera `x-internal-key` con el valor de
 * INTERNAL_API_KEY. Al ser servicios internos (sin autenticación de IAM en la
 * demo) esta cabecera compartida evita que cualquiera que descubra la URL pinte
 * o agote el límite.
 *
 * Idea futura: en Cloud Run, sustituirlo por IAM + tokens de identidad.
 */
export function internalAuthInterceptor(internalApiKey: string, serviceName: string): Interceptor {
  return (next) => async (request) => {
    if (internalApiKey === "") {
      throw new ConnectError(
        serviceName + ": INTERNAL_API_KEY no está configurada; se rechazan las peticiones",
        Code.Unauthenticated,
      );
    }
    if (request.header.get("x-internal-key") !== internalApiKey) {
      throw new ConnectError(
        serviceName + ": cabecera x-internal-key ausente o incorrecta",
        Code.Unauthenticated,
      );
    }
    return await next(request);
  };
}
