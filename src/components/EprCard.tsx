/** EPR karton (gépkocsinként) és negyedéves EPR összesítő – nyomtatható A4 álló lapok, a különbözeti ÁFA karton mintájára. */
import Link from "next/link";
import type { EprCard, EprDoc, EprQuarter } from "@/lib/epr-card";
import { EPR_CATEGORY_LABEL, EPR_DRIVE_LABEL, quarterLabel, quarterRange } from "@/lib/epr";
import { fmtHuf, fmtNum } from "@/lib/money";
import { fmtDate } from "@/lib/dates";
import { vehicleIdent } from "@/lib/vehicle-id";
import { DocMark } from "@/components/Brand";

const Ft = ({ v, strong }: { v: number | null | undefined; strong?: boolean }) =>
  v === null || v === undefined ? <span className="muted">–</span> : <span className={strong ? "strong" : undefined}>{fmtHuf(v)} Ft</span>;
const Kg = ({ v }: { v: number | null | undefined }) => (v ? <>{fmtNum(v)} kg</> : <span className="muted">–</span>);

function CompanyHead({ company, title, sub }: { company: EprCard["company"]; title: string; sub: string }) {
  return (
    <header className="mc-head">
      <div>
        <div className="mc-company">{company.name}</div>
        <div className="mc-sub">{[company.address, company.taxNumber ? `adószám: ${company.taxNumber}` : null].filter(Boolean).join(" · ")}</div>
      </div>
      <div className="mc-title">
        <h1>{title}</h1>
        <div className="mc-sub">{sub}</div>
      </div>
    </header>
  );
}

function DocTable({ docs, cid, empty }: { docs: EprDoc[]; cid: number; empty: string }) {
  return (
    <table className="mc-table">
      <thead><tr><th>Teljesítés</th><th>Bizonylat</th><th>Partner</th><th>Ország</th><th>Megnevezés</th><th className="num">Bruttó</th></tr></thead>
      <tbody>
        {docs.map((d) => (
          <tr key={d.invoiceId}>
            <td>{fmtDate(d.date)}</td>
            <td><Link href={`/c/${cid}/invoices/${d.invoiceId}`}>{d.number}</Link></td>
            <td>{d.partner}<div className="mc-sub">{d.partnerPrivate ? "magánszemély" : d.partnerTax ? `adószám: ${d.partnerTax}` : ""}</div></td>
            <td className="mono">{d.partnerCountry}</td>
            <td>{d.description}<div className="mc-sub">{d.vatCode}{d.currency !== "HUF" ? ` · ${d.currency}` : ""}</div></td>
            <td className="num">{fmtHuf(d.grossHuf)}</td>
          </tr>
        ))}
        {docs.length === 0 && <tr><td colSpan={6} className="muted">{empty}</td></tr>}
      </tbody>
    </table>
  );
}

const Checks = ({ checks }: { checks: EprCard["checks"] }) =>
  checks.length ? <ul className="mc-checks">{checks.map((c, i) => <li key={i} className={c.ok ? "ok" : "warn"}>{c.ok ? "✓" : "⚠"} {c.text}</li>)}</ul> : null;

const Foot = ({ printedAt }: { printedAt: string }) => (
  <footer className="mc-foot">
    <div className="mc-sign"><span>Készítette</span></div>
    <div className="mc-sign"><span>Ellenőrizte</span></div>
    <div className="mc-meta">Készült: {printedAt} · mogyorosi.erp</div>
  </footer>
);

export function EprCardSheet({ card, cid, printedAt }: { card: EprCard; cid: number; printedAt: string }) {
  const v = card.vehicle;
  const liableTxt = card.status.liable === true ? "KÖTELEZETT" : card.status.liable === false ? "nem kötelezett" : "NEM ELDÖNTHETŐ";
  return (
    <article className="mc-sheet">
      <CompanyHead company={card.company} title="EPR karton – gépjármű" sub={`80/2023. Korm. r. – kiterjesztett gyártói felelősség · ${liableTxt}`} />

      <section className="mc-vehicle">
        <dl>
          <div><dt>Gépkocsi</dt><dd>{v.make} {v.model}{v.year ? ` (${v.year})` : ""}</dd></div>
          <div><dt>{v.plate?.trim() ? "Rendszám" : "Azonosító (alvázszám)"}</dt><dd className="mono">{vehicleIdent(v) || "–"}</dd></div>
          <div><dt>Alvázszám</dt><dd className="mono">{v.vin ?? "–"}</dd></div>
          <div><dt>Járműkategória</dt><dd>{card.category ? EPR_CATEGORY_LABEL[card.category] : "–"}</dd></div>
          <div><dt>Hajtás</dt><dd>{card.drive ? EPR_DRIVE_LABEL[card.drive] : "–"}</dd></div>
          <div><dt>Tömeg</dt><dd><Kg v={card.massKg} /></dd></div>
          <div><dt>Származás</dt><dd>{card.origin === "import" ? "külföldről behozott" : card.origin === "domestic" ? "belföldi beszerzés" : "–"}{card.originSource === "override" ? " (kézi)" : ""}</dd></div>
          <div><dt>Forgalomba hozatal</dt><dd>{fmtDate(card.placedOn) || "–"}</dd></div>
          <div><dt>Karton azonosító</dt><dd className="mono">EPR-{card.company.id}-{v.id}</dd></div>
        </dl>
      </section>

      <h2>1. Beszerzés – származás</h2>
      <DocTable docs={card.purchases} cid={cid} empty="Nincs a gépkocsihoz rendelt beszerzési számla." />

      <h2>2. Első belföldi forgalomba hozatal (értékesítés)</h2>
      <DocTable docs={card.sales} cid={cid} empty="Még nincs vevőszámla." />

      <h2>3. KF kód és EPR-díj</h2>
      {card.status.liable ? (
        <table className="mc-calc">
          <tbody>
            <tr><td>KF kód (15 gépjármű · anyagáram · csoport · kollektív · származás)</td><td className="op" /><td className="num mono">{card.kfCode}</td></tr>
            <tr><td>Tárgynegyedév / adatszolgáltatási határidő</td><td className="op" /><td className="num">{card.quarter ? quarterLabel(card.quarter) : "–"} · {fmtDate(card.deadline)}</td></tr>
            <tr><td>Tömeg</td><td className="op" /><td className="num"><Kg v={card.massKg} /></td></tr>
            <tr><td>Díjtétel<div className="mc-sub">{card.rateLabel}</div></td><td className="op">×</td><td className="num">{fmtNum(card.rate)} Ft/kg</td></tr>
            <tr className="sum"><td>EPR-díj (a MOHU számlázza)</td><td className="op">=</td><td className="num"><Ft v={card.fee} strong /></td></tr>
          </tbody>
        </table>
      ) : (
        <p className="mc-note">{card.status.reason}</p>
      )}

      <div className="mc-end">
        <Checks checks={card.checks} />
        <Foot printedAt={printedAt} />
      </div>
      <DocMark />
    </article>
  );
}

/** Negyedéves összesítő (C layout): fent a fő számok, alatta gépkocsinkénti mini kartonok, végül a KF kódonkénti bontás az OKIR-hoz. */
export function EprQuarterSheet({ data, cid, printedAt }: { data: EprQuarter; cid: number; printedAt: string }) {
  const { from, to } = quarterRange(data.quarter);
  const flat = !!data.company.settings.eprFlatRate;
  return (
    <article className="mc-sheet">
      <CompanyHead company={data.company} title={`EPR ${data.quarter.year} Q${data.quarter.q}`} sub={`Gépjármű termékáram · ${fmtDate(from)} – ${fmtDate(to)} · ${flat ? "díjátalány" : "átalány nélkül"}`} />

      <section className="epr-metrics">
        <div className="epr-box"><div className="mc-sub">Autó</div><div className="epr-num">{data.totals.count} db</div></div>
        <div className="epr-box"><div className="mc-sub">Díj</div><div className="epr-num">{fmtHuf(data.totals.fee)} Ft</div></div>
        <div className="epr-box"><div className="mc-sub">Tömeg</div><div className="epr-num">{fmtNum(data.totals.massKg)} kg</div></div>
        <div className="epr-box"><div className="mc-sub">Határidő (OKIR)</div><div className="epr-num">{fmtDate(data.deadline)}</div></div>
      </section>

      <section className="epr-cards">
        {data.cards.map((c) => (
          <div key={c.vehicle.id} className="epr-box epr-card">
            <div className="epr-card-title">
              <Link href={`/c/${cid}/vehicles/${c.vehicle.id}/epr`}>{c.vehicle.make} {c.vehicle.model}</Link> · <span className="mono">{vehicleIdent(c.vehicle)}</span>
            </div>
            <div className="mc-sub">{c.origin === "import" ? "Import" : "HU"} → {c.sales[0]?.partnerCountry ?? "HU"} · {fmtDate(c.placedOn)} · <span className="mono">{c.kfCode}</span></div>
            <div className="mc-sub">{c.massKg ? `${fmtNum(c.massKg)} kg` : "⚠ nincs tömeg"} · {c.fee !== null ? `${fmtHuf(c.fee)} Ft` : "–"}</div>
          </div>
        ))}
        {data.cards.length === 0 && <p className="mc-note">A negyedévben nem volt EPR-köteles forgalomba hozatal – nemleges adatszolgáltatás.</p>}
      </section>

      {data.undecided.length > 0 && (
        <>
          <h2>Nem eldönthető – pótolandó adat</h2>
          <section className="epr-cards">
            {data.undecided.map((c) => (
              <div key={c.vehicle.id} className="epr-box epr-card warn">
                <div className="epr-card-title"><Link href={`/c/${cid}/vehicles?edit=${c.vehicle.id}`}>{c.vehicle.make} {c.vehicle.model}</Link> · <span className="mono">{vehicleIdent(c.vehicle)}</span></div>
                <div className="mc-sub">⚠ {c.status.reason}</div>
              </div>
            ))}
          </section>
        </>
      )}

      <div className="mc-end">
        <h2>KF kódonként (OKIR KG:KGYF-NÉ)</h2>
        <table className="mc-table">
          <thead><tr><th>KF kód</th><th>Kategória</th><th className="num">Darab</th><th className="num">kg</th><th className="num">Díjtétel</th><th className="num">Díj</th></tr></thead>
          <tbody>
            {data.summary.map((s) => (
              <tr key={s.kfCode}>
                <td className="mono">{s.kfCode}</td>
                <td>{EPR_CATEGORY_LABEL[s.category]}{s.missingMass ? <div className="mc-sub">⚠ {s.missingMass} db tömeg nélkül</div> : null}</td>
                <td className="num">{s.count}</td>
                <td className="num">{fmtNum(s.massKg)}</td>
                <td className="num">{s.rate !== null ? `${fmtNum(s.rate)} Ft/kg` : "vegyes"}</td>
                <td className="num">{fmtHuf(s.fee)}</td>
              </tr>
            ))}
            {data.summary.length === 0 && <tr><td colSpan={6} className="muted">Nincs tétel.</td></tr>}
          </tbody>
        </table>
        <Foot printedAt={printedAt} />
      </div>
      <DocMark />
    </article>
  );
}
