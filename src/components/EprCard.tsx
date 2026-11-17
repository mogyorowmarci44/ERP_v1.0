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

/** Negyedéves összesítő – az OKIR KG:KGYF-NÉ adatszolgáltatás kitöltéséhez, KF kódonként. */
export function EprQuarterSheet({ data, cid, printedAt }: { data: EprQuarter; cid: number; printedAt: string }) {
  const { from, to } = quarterRange(data.quarter);
  const flat = !!data.company.settings.eprFlatRate;
  return (
    <article className="mc-sheet">
      <CompanyHead company={data.company} title="EPR negyedéves összesítő" sub={`Gépjármű termékáram · ${quarterLabel(data.quarter)} · ${flat ? "díjátalány" : "átalány nélkül"}`} />
      <section className="mc-vehicle">
        <dl>
          <div><dt>Időszak</dt><dd>{fmtDate(from)} – {fmtDate(to)}</dd></div>
          <div><dt>Adatszolgáltatás határideje</dt><dd>{fmtDate(data.deadline)}</dd></div>
          <div><dt>Felület</dt><dd>OKIR-kapu · KG:KGYF-NÉ</dd></div>
        </dl>
      </section>

      <h2>1. Összesítés KF kódonként</h2>
      <table className="mc-table">
        <thead><tr><th>KF kód</th><th>Kategória</th><th className="num">Darab</th><th className="num">Mennyiség (kg)</th><th className="num">Díjtétel</th><th className="num">EPR-díj</th></tr></thead>
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
          {data.summary.length === 0 && <tr><td colSpan={6} className="muted">A negyedévben nem volt EPR-köteles forgalomba hozatal – nemleges adatszolgáltatás.</td></tr>}
        </tbody>
        <tfoot><tr><td colSpan={2}>Összesen</td><td className="num">{data.totals.count}</td><td className="num">{fmtNum(data.totals.massKg)}</td><td /><td className="num"><Ft v={data.totals.fee} strong /></td></tr></tfoot>
      </table>

      <h2>2. Tételes lista</h2>
      <table className="mc-table">
        <thead><tr><th>Forgalomba hozatal</th><th>Gépkocsi</th><th>Azonosító</th><th>Vevőszámla</th><th className="num">kg</th><th className="num">Díj</th></tr></thead>
        <tbody>
          {data.cards.map((c) => (
            <tr key={c.vehicle.id}>
              <td>{fmtDate(c.placedOn)}</td>
              <td><Link href={`/c/${cid}/vehicles/${c.vehicle.id}/epr`}>{c.vehicle.make} {c.vehicle.model}{c.vehicle.year ? ` (${c.vehicle.year})` : ""}</Link><div className="mc-sub mono">{c.kfCode}</div></td>
              <td className="mono">{vehicleIdent(c.vehicle)}</td>
              <td>{c.sales[0]?.number}</td>
              <td className="num">{c.massKg ? fmtNum(c.massKg) : "⚠"}</td>
              <td className="num">{c.fee !== null ? fmtHuf(c.fee) : "–"}</td>
            </tr>
          ))}
          {data.cards.length === 0 && <tr><td colSpan={6} className="muted">Nincs tétel.</td></tr>}
        </tbody>
      </table>

      {data.undecided.length > 0 && (
        <>
          <h2>3. Nem eldönthető – pótolandó adat</h2>
          <table className="mc-table">
            <thead><tr><th>Gépkocsi</th><th>Azonosító</th><th>Ok</th></tr></thead>
            <tbody>
              {data.undecided.map((c) => (
                <tr key={c.vehicle.id}>
                  <td><Link href={`/c/${cid}/vehicles?edit=${c.vehicle.id}`}>{c.vehicle.make} {c.vehicle.model}</Link></td>
                  <td className="mono">{vehicleIdent(c.vehicle)}</td>
                  <td>{c.status.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <div className="mc-end">
        <p className="mc-note">
          Kötelezett: a külföldről behozott gépjármű első belföldi eladása. Belföldi beszerzésű és külföldre eladott gépkocsi nem szerepel.
          A díjat a MOHU számlázza az adatszolgáltatás alapján – a számlát ezzel az összeggel egyeztesd.
          {flat ? " A díjátalány a tartozékok, alkotórészek és a csomagolás díját is tartalmazza." : " Átalány nélkül az akkumulátor, gumiabroncs és beépített elektromos eszközök külön KF kódon szerepelnek – ezeket ez az összesítő nem tartalmazza."}
        </p>
        <Foot printedAt={printedAt} />
      </div>
      <DocMark />
    </article>
  );
}
