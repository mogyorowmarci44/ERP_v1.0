/** v7.5.0 – Jóváhagyás kifizetés előtt (tiszta függvény). */
export type ApprovalSettings = { on: boolean; threshold: number } | null | undefined;
export type ApprovalInvoice = { direction: string; grossHuf: number | string; approvedAt: Date | null; status: string };

/** Igaz, ha a bejövő számla fizetés előtt még jóváhagyásra vár. */
export function needsApproval(s: ApprovalSettings, inv: ApprovalInvoice): boolean {
  if (!s?.on || inv.direction !== "in" || inv.status !== "posted" || inv.approvedAt) return false;
  return Math.abs(Number(inv.grossHuf)) >= Math.max(0, Number(s.threshold) || 0);
}

/** Ki hagyhat jóvá: a tulajdonos és az ügyvezető (CEO) – a könyvelő nem (négy szem elve: aki könyvel, nem engedélyez). */
export const canApprove = (role: string) => role === "owner" || role === "viewer";
