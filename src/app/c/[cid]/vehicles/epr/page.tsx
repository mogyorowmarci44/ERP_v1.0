import Link from "next/link";
import { requireCompany } from "@/lib/auth";
import { eprQuarter } from "@/lib/epr-card";
import { EprCardSheet, EprQuarterSheet } from "@/components/EprCard";
import { PrintButton } from "@/components/PrintButton";
import { quarterOf, type Quarter } from "@/lib/epr";
import { today } from "@/lib/dates";
import { fmtHuf } from "@/lib/money";

/** Negyedéves EPR összesítő + a kötelezett gépkocsik kartonjai egyben – az OKIR adatszolgáltatás mellé. */
export default async function EprQuarterPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  await requireCompany(cid);
  // Alapértelmezés: az előző negyedév (amit éppen be kell vallani).
  const cur = quarterOf(today());
  const prev: Quarter = cur.q === 1 ? { year: cur.year - 1, q: 4 } : { year: cur.year, q: (cur.q - 1) as Quarter["q"] };
  const year = Number(sp.year) || prev.year;
  const q = ([1, 2, 3, 4].includes(Number(sp.q)) ? Number(sp.q) : prev.q) as Quarter["q"];
  const data = await eprQuarter(cid, { year, q });
  const withCards = sp.cards === "1";
  const printedAt = new Date().toLocaleString("hu-HU", { timeZone: "Europe/Budapest" });
  const years = Array.from({ length: 4 }, (_, i) => cur.year - i);
  return (
    <>
      <div className="topbar no-print">
        <h1>EPR – gépjármű adatszolgáltatás</h1>
        <div className="row">
          <Link className="btn" href={`/c/${cid}/vehicles?all=1`}>← Gépkocsik</Link>
          <PrintButton label={withCards ? `Összesítő + ${data.cards.length} karton nyomtatása / PDF` : "Összesítő nyomtatása / PDF"} />
        </div>
      </div>
      <form className="row card no-print" style={{ marginBottom: 12 }}>
        <label>Év<select name="year" defaultValue={year}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select></label>
        <label>Negyedév<select name="q" defaultValue={q}>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}. negyedév</option>)}</select></label>
        <label className="row" style={{ alignSelf: "end" }}><input type="checkbox" name="cards" value="1" defaultChecked={withCards} /> kartonokkal együtt</label>
        <button style={{ alignSelf: "end" }}>Szűrés</button>
        <span className="muted" style={{ alignSelf: "end" }}>
          {data.totals.count} kötelezett gépkocsi · {fmtHuf(data.totals.fee)} Ft{data.undecided.length ? ` · ⚠ ${data.undecided.length} nem eldönthető` : ""}
        </span>
      </form>
      <EprQuarterSheet data={data} cid={cid} printedAt={printedAt} />
      {withCards && data.cards.map((c) => <EprCardSheet key={c.vehicle.id} card={c} cid={cid} printedAt={printedAt} />)}
    </>
  );
}
