/** Különbözeti ÁFA karton – nyomtatható A4 álló lap (egy gépkocsi). */
import Link from "next/link";
import type { MarginCard as Card, CardDoc } from "@/lib/margin-card";
import { fmtHuf } from "@/lib/money";
import { fmtDate } from "@/lib/dates";
import { vehicleIdent } from "@/lib/vehicle-id";

const Ft = ({ v, strong }: { v: number | null | undefined; strong?: boolean }) =>
  v === null || v === undefined ? <span className="muted">–</span> : <span className={strong ? "strong" : undefined}>{fmtHuf(v)} Ft</span>;

function DocRows({ docs, cid, showMargin }: { docs: CardDoc[]; cid: number; showMargin?: boolean }) {
  return (
    <>
      {docs.map((d, i) => (
        <tr key={i}>
          <td>{fmtDate(d.date)}</td>
          <td>{d.invoiceId ? <Link href={`/c/${cid}/invoices/${d.invoiceId}`}>{d.number}</Link> : d.number}</td>
          <td>{d.partner}<div className="mc-sub">{d.partnerPrivate ? "magánszemély" : d.partnerTax ? `adószám: ${d.partnerTax}` : ""}</div></td>
          <td>{d.description}<div className="mc-sub">{d.vatCode}{d.amountFx !== null ? ` · ${d.amountFx.toLocaleString("hu-HU")} ${d.currency} × ${d.rate?.toLocaleString("hu-HU")}` : ""}</div></td>
          {showMargin && <td className="num">{d.vatHuf ? fmtHuf(d.vatHuf) : "–"}</td>}
          <td className="num">{fmtHuf(d.grossHuf)}</td>
        </tr>
      ))}
    </>
  );
}

export function MarginCardSheet({ card, cid, printedAt }: { card: Card; cid: number; printedAt: string }) {
  const v = card.vehicle;
  const s = card.sale;
  const other = card.otherCosts.reduce((a, d) => a + d.netHuf, 0);
  return (
    <article className="mc-sheet">
      <header className="mc-head">
        <div>
          <div className="mc-company">{card.company.name}</div>
          <div className="mc-sub">{[card.company.address, card.company.taxNumber ? `adószám: ${card.company.taxNumber}` : null].filter(Boolean).join(" · ")}</div>
        </div>
        <div className="mc-title">
          <h1>Különbözeti ÁFA karton</h1>
          <div className="mc-sub">Áfa tv. 210–219. § – használt cikk, tételes módszer{!s && " · ELŐZETES (még nincs eladva)"}</div>
        </div>
      </header>

      <section className="mc-vehicle">
        <dl>
          <div><dt>Gépkocsi</dt><dd>{v.make} {v.model}{v.year ? ` (${v.year})` : ""}</dd></div>
          <div><dt>{v.plate?.trim() ? "Rendszám" : "Azonosító (alvázszám – nincs rendszám)"}</dt><dd className="mono">{vehicleIdent(v) || "–"}</dd></div>
          <div><dt>Alvázszám</dt><dd className="mono">{v.vin ?? "–"}</dd></div>
          <div><dt>Beszerzés</dt><dd>{fmtDate(v.purchaseDate) || "–"}</dd></div>
          <div><dt>Eladás</dt><dd>{s ? fmtDate(card.sales[0].date) : "–"}</dd></div>
          <div><dt>Karton azonosító</dt><dd className="mono">KK-{card.company.id}-{v.id}</dd></div>
        </dl>
      </section>

      <h2>1. Beszerzés – a különbözet alapja</h2>
      <table className="mc-table">
        <thead><tr><th>Teljesítés</th><th>Bizonylat</th><th>Eladó</th><th>Megnevezés</th><th className="num">Beszerzési ár</th></tr></thead>
        <tbody>
          <DocRows docs={card.purchases} cid={cid} />
          {card.purchases.length === 0 && <tr><td colSpan={5} className="muted">Nincs különbözeti beszerzési bizonylat.</td></tr>}
        </tbody>
        <tfoot>
          <tr><td colSpan={4}>Beszerzési ár (különbözeti adóalaphoz){card.marginBaseSource === "override" ? " – a gépkocsinál kézzel megadva" : ""}</td><td className="num"><Ft v={card.marginBase} strong /></td></tr>
        </tfoot>
      </table>

      <h2>2. Értékesítés</h2>
      <table className="mc-table">
        <thead><tr><th>Teljesítés</th><th>Számla</th><th>Vevő</th><th>Megnevezés</th><th className="num">ÁFA</th><th className="num">Eladási ár (bruttó)</th></tr></thead>
        <tbody>
          <DocRows docs={card.sales} cid={cid} showMargin />
          {card.sales.length === 0 && (
            <tr><td colSpan={6} className="muted">Még nincs vevőszámla.{card.plan ? ` Tervezett eladás: ${fmtHuf(card.plan.price)} Ft${card.plan.date ? `, ${fmtDate(card.plan.date)}` : ""} (Forecast).` : ""}</td></tr>
          )}
        </tbody>
      </table>

      <h2>3. Különbözeti ÁFA számítása</h2>
      {(() => {
        const gross = s?.gross ?? card.plan?.price ?? null;
        const margin = gross !== null ? gross - card.marginBase : null;
        const vat = margin !== null ? Math.max(0, Math.round((margin * 27) / 127)) : null;
        return (
          <table className="mc-calc">
            <tbody>
              <tr><td>Eladási ár (ellenérték, ÁFA-val){!s && gross !== null ? " – tervezett" : ""}</td><td className="op" /><td className="num"><Ft v={gross} /></td></tr>
              <tr><td>Beszerzési ár</td><td className="op">−</td><td className="num"><Ft v={card.marginBase} /></td></tr>
              <tr className="sum"><td>Különbözet (ÁFA-t tartalmazó árrés)</td><td className="op">=</td><td className="num"><Ft v={margin} strong /></td></tr>
              <tr><td>Különbözeti ÁFA = különbözet × 27/127{margin !== null && margin < 0 ? " (negatív különbözet → 0)" : ""}</td><td className="op" /><td className="num"><Ft v={s ? s.vatBooked : vat} strong /></td></tr>
              <tr><td>Adóalap = különbözet − ÁFA (különbözet × 100/127)</td><td className="op" /><td className="num"><Ft v={margin !== null ? Math.max(0, margin) - (vat ?? 0) : null} /></td></tr>
              {s && <tr className="muted-row"><td>Ellenőrzés: számított ÁFA</td><td className="op" /><td className="num"><Ft v={s.vatComputed} /></td></tr>}
            </tbody>
          </table>
        );
      })()}

      <h2>4. Tájékoztatásul – bekerülési érték és eredmény</h2>
      <p className="mc-note">A bekerülési értéket (ELÁBÉ) növelik, de a különbözeti ÁFA alapjába nem számítanak (honosítás, fuvar, javítás …); ÁFA-juk a normál szabályok szerint kezelendő.</p>
      <table className="mc-table">
        <thead><tr><th>Teljesítés</th><th>Bizonylat</th><th>Szállító</th><th>Megnevezés</th><th className="num">ÁFA</th><th className="num">Bruttó</th></tr></thead>
        <tbody>
          <DocRows docs={card.otherCosts} cid={cid} showMargin />
          {card.otherCosts.length === 0 && <tr><td colSpan={6} className="muted">Nincs ilyen tétel.</td></tr>}
        </tbody>
        <tfoot><tr><td colSpan={5}>Egyéb aktivált tételek nettó értéke</td><td className="num"><Ft v={other} /></td></tr></tfoot>
      </table>
      <table className="mc-calc">
        <tbody>
          <tr><td>Nettó árbevétel (eladási ár − különbözeti ÁFA)</td><td className="num"><Ft v={s?.netRevenue ?? null} /></td></tr>
          <tr><td>{s ? "Eladott áru beszerzési értéke (ELÁBÉ, 814)" : "Könyv szerinti érték (261)"}</td><td className="num"><Ft v={s ? card.cogs : card.bookValue} /></td></tr>
          <tr className="sum"><td>Bruttó fedezet a gépkocsin</td><td className="num"><Ft v={card.profit} strong /></td></tr>
        </tbody>
      </table>

      <div className="mc-end">
      {card.checks.length > 0 && (
        <ul className="mc-checks">
          {card.checks.map((c, i) => <li key={i} className={c.ok ? "ok" : "warn"}>{c.ok ? "✓" : "⚠"} {c.text}</li>)}
        </ul>
      )}

      <footer className="mc-foot">
        <div className="mc-sign"><span>Készítette</span></div>
        <div className="mc-sign"><span>Ellenőrizte</span></div>
        <div className="mc-meta">Készült: {printedAt} · MM ERP</div>
      </footer>
      </div>
    </article>
  );
}
