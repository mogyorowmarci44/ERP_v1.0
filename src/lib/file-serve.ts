/**
 * v7.1.0 – csak ezek nyílhatnak meg a böngészőben (előnézet). Minden más (HTML, SVG, XML, …) letöltésként megy ki,
 * így egy feltöltött (pl. a mobilos portálról érkező) kártékony fájl nem futtathat szkriptet a könyvelő munkamenetében.
 */
export const INLINE_SAFE = new Set(["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp", "image/heic", "image/heif", "text/plain", "text/csv"]);
export function servedAs(mime: string): { type: string; inline: boolean } {
  const m = (mime || "").toLowerCase().split(";")[0].trim();
  return INLINE_SAFE.has(m) ? { type: m.startsWith("text/") ? `${m}; charset=utf-8` : m, inline: true } : { type: "application/octet-stream", inline: false };
}

