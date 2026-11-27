import Link from "next/link";

/** v6.7.0 – Lapozó: „1–100 / 2 345” és előző / következő; a többi szűrőt (query) megtartja. */
export function Pager({ page, size, total, query }: { page: number; size: number; total: number; query: Record<string, string | undefined> }) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (total <= size) return null;
  const href = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v) q.set(k, v);
    if (p > 1) q.set("page", String(p));
    return `?${q.toString()}`;
  };
  const from = (page - 1) * size + 1;
  const to = Math.min(total, page * size);
  return (
    <div className="row no-print" style={{ gap: 12, margin: "10px 0", alignItems: "center" }}>
      {page > 1 ? <Link className="btn" href={href(page - 1)}>← Előző</Link> : <span className="btn" aria-disabled style={{ opacity: 0.4 }}>← Előző</span>}
      <span className="muted">{from.toLocaleString("hu-HU")}–{to.toLocaleString("hu-HU")} / {total.toLocaleString("hu-HU")} · {page}. oldal ({pages})</span>
      {page < pages ? <Link className="btn" href={href(page + 1)}>Következő →</Link> : <span className="btn" aria-disabled style={{ opacity: 0.4 }}>Következő →</span>}
    </div>
  );
}

/** Oldalszám a query-ből (1-től), a lapok számára korlátozva. */
export function pageOf(raw: string | undefined, total: number, size: number) {
  const p = Math.max(1, Math.floor(Number(raw) || 1));
  return Math.min(p, Math.max(1, Math.ceil(total / size)));
}
