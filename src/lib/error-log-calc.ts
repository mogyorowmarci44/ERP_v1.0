import { createHash } from "node:crypto";

/**
 * v6.7.0 – Hibanapló (tiszta függvények): melyik hiba programhiba (és nem felhasználói hibaüzenet), és hogyan csoportosítsuk.
 */

/** Programhiba-e (és nem a felhasználónak szóló ellenőrzési üzenet). */
export function isSystemError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  if (e instanceof TypeError || e instanceof ReferenceError || e instanceof RangeError || e instanceof SyntaxError) return true;
  const code = (e as { code?: unknown }).code ?? (e as { cause?: { code?: unknown } }).cause?.code;
  // Postgres-hibakód (pl. 42703 nem létező oszlop) – a duplikált kulcs (23505) felhasználói eset
  if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) && code !== "23505") return true;
  if (/^Failed query:/.test(e.message) && code !== "23505") return true;
  return /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|fetch failed|Cannot read properties|is not a function|is not defined/i.test(e.message);
}

/** Csoportosító kulcs: a számok és azonosítók kiszűrésével, az első saját veremsorral. */
export function fingerprint(message: string, stack?: string | null, path?: string | null): string {
  const norm = message.replace(/\d+/g, "#").replace(/"[^"]{0,80}"/g, '"…"').slice(0, 300);
  const frame = (stack ?? "").split("\n").find((l) => /src\/|\.next\/server\//.test(l))?.replace(/:\d+:\d+\)?$/, "").trim() ?? "";
  const route = (path ?? "").replace(/\/\d+(?=\/|$|\?)/g, "/#").replace(/\?.*$/, "");
  return createHash("sha256").update(`${norm}|${frame}|${route}`).digest("hex");
}

/** Next.js belső vezérlő „hibák” (átirányítás, 404) nem kerülnek a naplóba. */
export const isControlFlow = (e: unknown) => {
  const d = (e as { digest?: unknown })?.digest;
  return typeof d === "string" && /^(NEXT_REDIRECT|NEXT_NOT_FOUND|NEXT_HTTP_ERROR_FALLBACK|DYNAMIC_SERVER_USAGE|BAILOUT_TO_CLIENT_SIDE_RENDERING)/.test(d);
};
