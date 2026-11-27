/**
 * v6.7.0 – Next.js instrumentáció: minden kezeletlen szerveroldali hiba (oldal, útvonal, szerveroldali művelet) a hibanaplóba kerül.
 */
export async function onRequestError(err: unknown, request: { path: string; method: string }, context: { routerKind: string; routeType: string; routePath?: string }) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { recordError } = await import("@/lib/error-log");
  const m = request.path.match(/^\/c\/(\d+)/);
  await recordError(err, { path: request.path, method: request.method, kind: `${context.routeType}${context.routePath ? ` ${context.routePath}` : ""}`.slice(0, 32), companyId: m ? Number(m[1]) : null });
}
