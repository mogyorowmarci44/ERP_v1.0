/** v2.0 – Értékelések (Airbnb): összesítés, kategóriák, címkék, trend, teljes lista. */
import { notFound } from "next/navigation";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ReviewRatings } from "@/db/schema";
import { requireCompany } from "@/lib/auth";
import { isPrivate } from "@/lib/entity";
import { fmtDate } from "@/lib/dates";
import { fmtNum, fmtPct } from "@/lib/gh-view";

const CAT: Array<[keyof ReviewRatings, string]> = [
  ["checkin", "Bejelentkezés"],
  ["cleanliness", "Tisztaság"],
  ["accuracy", "Pontosság"],
  ["communication", "Kommunikáció"],
  ["location", "Elhelyezkedés"],
  ["value", "Ár-érték"],
  ["rooms", "Szobák (Google)"],
  ["service", "Szolgáltatás (Google)"],
];
const SRC: Record<string, string> = { airbnb: "Airbnb", google: "Google" };
const TAG_LABEL: Record<string, string> = { highlights: "Kiemelt jellemzők", trip: "Utazás" };
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const stars = (n: number | null | undefined) => (n ? "★".repeat(n) + "☆".repeat(Math.max(0, 5 - n)) : "–");

export default async function ReviewsPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  const { company } = await requireCompany(cid);
  if (!isPrivate(company)) notFound();
  const every = await db.select().from(schema.ghReviews).where(eq(schema.ghReviews.companyId, cid)).orderBy(desc(schema.ghReviews.reviewedAt));
  const base = `/c/${cid}/gh/reviews`;
  const src = sp.src === "airbnb" || sp.src === "google" ? sp.src : "";
  const all = src ? every.filter((r) => r.source === src) : every;
  const sources = [...new Set(every.map((r) => r.source))];
  if (!every.length) {
    return (
      <div className="gh">
        <h1>Értékelések</h1>
        <p className="muted">Még nincs betöltött értékelés. Az Áttekintés oldalon az „Adatfrissítés” résznél töltsd be az Airbnb-szinkronfájlt.</p>
      </div>
    );
  }
  const only = /^[1-5]$/.test(sp.stars ?? "") ? Number(sp.stars) : sp.stars === "low" ? -1 : 0;
  const year = /^\d{4}$/.test(sp.year ?? "") ? sp.year : "";
  const list = all.filter((r) => (only === -1 ? (r.overall ?? 5) <= 4 : only ? r.overall === only : true) && (year ? r.reviewedAt.slice(0, 4) === year : true));
  const rated = all.filter((r) => r.overall);
  const overall = avg(rated.map((r) => r.overall!));
  const dist = [5, 4, 3, 2, 1].map((n) => [n, rated.filter((r) => r.overall === n).length] as const);
  const cats = CAT.map(([k, label]) => {
    const xs = all.map((r) => r.ratings?.[k]).filter((x): x is number => typeof x === "number");
    return { k, label, avg: avg(xs), n: xs.length, low: xs.filter((x) => x <= 3).length };
  });
  const years = [...new Set(all.map((r) => r.reviewedAt.slice(0, 4)))].sort();
  const byYear = years.map((y) => {
    const rs = all.filter((r) => r.reviewedAt.slice(0, 4) === y);
    return { y, n: rs.length, overall: avg(rs.filter((r) => r.overall).map((r) => r.overall!)), cats: CAT.map(([k]) => avg(rs.map((r) => r.ratings?.[k]).filter((x): x is number => typeof x === "number"))) };
  });
  const tagCount = new Map<string, number>();
  for (const r of all) for (const [c, ts] of Object.entries(r.tags ?? {})) for (const t of ts) tagCount.set(`${c}|${t}`, (tagCount.get(`${c}|${t}`) ?? 0) + 1);
  const catLabel = { ...Object.fromEntries(CAT), ...TAG_LABEL } as Record<string, string>;
  const tags = [...tagCount.entries()].sort((a, b) => b[1] - a[1]);
  const weakest = [...cats].filter((c) => c.avg !== null).sort((a, b) => a.avg! - b.avg!)[0];
  const q = (o: Record<string, string>) => { const u = new URLSearchParams({ ...(only ? { stars: sp.stars } : {}), ...(year ? { year } : {}), ...(src ? { src } : {}), ...o }); for (const [k, v] of [...u]) if (!v) u.delete(k); const s = u.toString(); return s ? `${base}?${s}` : base; };

  return (
    <div className="gh">
      <div className="topbar">
        <h1>Értékelések</h1>
        <div className="toolbar">
          <span className="muted" style={{ fontSize: 13 }}>{sources.map((x) => `${SRC[x] ?? x}: ${every.filter((r) => r.source === x).length}`).join(" · ")}</span>
          <div className="segmented">
            <Link href={q({ src: "" })} className={!src ? "on" : ""}>Mind</Link>
            {sources.map((x) => <Link key={x} href={q({ src: x })} className={src === x ? "on" : ""}>{SRC[x] ?? x}</Link>)}
          </div>
        </div>
      </div>

      <div className="grid cols-4">
        <div className="card kpi"><div className="label">Átlagos összpontszám</div><div className="value">{fmtNum(overall, 2)}<small>/ 5</small></div><div className="hint">{rated.length} pontozott értékelés</div></div>
        <div className="card kpi"><div className="label">5 csillagos arány</div><div className="value">{fmtPct(dist[0][1] / Math.max(1, rated.length))}</div><div className="hint">{dist.map(([n, c]) => `${n}★: ${c}`).join(" · ")}</div></div>
        <div className="card kpi"><div className="label">Leggyengébb kategória</div><div className="value">{weakest ? fmtNum(weakest.avg, 2) : "–"}<small>{weakest?.label}</small></div><div className="hint">{weakest ? `${weakest.low} értékelés adott rá 3 vagy kevesebb pontot` : ""}</div></div>
        <div className="card kpi"><div className="label">Utolsó 12 értékelés átlaga</div><div className="value">{fmtNum(avg(rated.slice(0, 12).map((r) => r.overall!)), 2)}<small>/ 5</small></div><div className="hint">a teljes átlag: {fmtNum(overall, 2)}</div></div>
      </div>

      <h2>Kategóriák évenként</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Év</th><th className="num">Értékelés</th><th className="num">Összpontszám</th>{CAT.map(([k, l]) => <th key={k} className="num">{l}</th>)}</tr></thead>
          <tbody>
            {byYear.map((r) => (
              <tr key={r.y}><td><Link href={q({ year: year === r.y ? "" : r.y })}>{r.y}</Link></td><td className="num">{r.n}</td><td className="num">{fmtNum(r.overall, 2)}</td>{r.cats.map((c, i) => <td key={i} className="num">{fmtNum(c, 2)}</td>)}</tr>
            ))}
          </tbody>
          <tfoot><tr><td>Összesen</td><td className="num">{all.length}</td><td className="num">{fmtNum(overall, 2)}</td>{cats.map((c) => <td key={c.k} className="num">{fmtNum(c.avg, 2)}</td>)}</tr></tfoot>
        </table>
      </div>

      {tags.length ? (
        <>
          <h2>Mit emeltek ki a vendégek</h2>
          <div className="card" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {tags.map(([k, n]) => {
              const [c, t] = k.split("|");
              return <span key={k} className="tag" title={catLabel[c] ?? c}>{t} <b>{n}</b></span>;
            })}
          </div>
        </>
      ) : null}

      <div className="row" style={{ justifyContent: "space-between", marginTop: 22 }}>
        <h2 style={{ margin: 0 }}>Értékelések ({list.length}{year ? `, ${year}` : ""})</h2>
        <div className="segmented">
          <Link href={q({ stars: "" })} className={!only ? "on" : ""}>Mind</Link>
          <Link href={q({ stars: "5" })} className={only === 5 ? "on" : ""}>5★</Link>
          <Link href={q({ stars: "low" })} className={only === -1 ? "on" : ""}>4★ és alatta</Link>
        </div>
      </div>
      <div className="grid" style={{ gap: 10, marginTop: 10 }}>
        {list.map((r) => (
          <article key={r.id} className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div><strong>{r.guest}</strong>{r.guestLocation ? <span className="muted"> · {r.guestLocation}</span> : null}<span className="muted"> · {SRC[r.source] ?? r.source}</span> <span style={{ color: "var(--warn, #b7791f)", letterSpacing: 1 }}>{stars(r.overall)}</span></div>
              <div className="muted" style={{ fontSize: 12.5 }}>{r.stayFrom && r.stayTo ? `tartózkodás: ${fmtDate(r.stayFrom)} – ${fmtDate(r.stayTo)} · ` : ""}értékelve: {r.dateApprox ? `kb. ${r.reviewedAt.slice(0, 4)}. ${r.reviewedAt.slice(5, 7)}.` : fmtDate(r.reviewedAt)}</div>
            </div>
            {r.text ? <p style={{ margin: "8px 0", whiteSpace: "pre-wrap" }}>{r.text}</p> : <p className="muted" style={{ margin: "8px 0" }}>(szöveg nélkül)</p>}
            {r.privateNote ? <p style={{ margin: "8px 0", padding: "8px 10px", background: "var(--surface-2)", borderRadius: 8, whiteSpace: "pre-wrap" }}><span className="muted">{r.source === "airbnb" ? "Privát megjegyzés neked: " : "Megjegyzés: "}</span>{r.privateNote}</p> : null}
            {r.reply ? <p className="muted" style={{ margin: "8px 0", whiteSpace: "pre-wrap" }}>Válaszod: {r.reply}</p> : null}
            <div className="legend">
              {CAT.map(([k, l]) => (r.ratings?.[k] ? <span key={k} className={r.ratings[k]! <= 3 ? "neg" : ""}>{l}: <b>{r.ratings[k]}</b></span> : null))}
            </div>
            {Object.values(r.tags ?? {}).flat().length ? <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>{Object.entries(r.tags ?? {}).map(([c, ts]) => `${catLabel[c] ?? c}: ${ts.join(", ")}`).join(" · ")}</div> : null}
          </article>
        ))}
      </div>
    </div>
  );
}
