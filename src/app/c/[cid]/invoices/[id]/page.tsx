import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, inArray, like, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCompany } from "@/lib/auth";
import { invoiceOpenAmount } from "@/lib/ledger";
import { invoicePayments } from "@/lib/reports";
import { postInvoiceAction, cancelInvoiceAction, reversePaymentAction, toggleInvoiceCheckAction, saveInvoiceCheckNoteAction } from "../../actions";
import { invoiceAudit } from "@/lib/invoice-audit";
import { PaymentForm } from "@/components/PaymentForm";
import { Flash } from "@/components/Flash";
import { fmtHuf, fmtMoney } from "@/lib/money";
import { fmtDate, today } from "@/lib/dates";

const statusHu = { draft: "piszkozat", posted: "könyvelt", cancelled: "sztornózott" } as const;

export default async function InvoicePage({ params, searchParams }: { params: Promise<{ cid: string; id: string }>; searchParams: Promise<Record<string, string>> }) {
  const p = await params;
  const sp = await searchParams;
  const cid = Number(p.cid);
  const id = Number(p.id);
  const { role } = await requireCompany(cid);
  const canWrite = role !== "viewer";
  const [row] = await db
    .select({ i: schema.invoices, partner: schema.partners })
    .from(schema.invoices)
    .innerJoin(schema.partners, eq(schema.partners.id, schema.invoices.partnerId))
    .where(and(eq(schema.invoices.id, id), eq(schema.invoices.companyId, cid)));
  if (!row) notFound();
  const { i: inv, partner } = row;

  const lines = await db
    .select({ l: schema.invoiceLines, vat: schema.vatCodes, acc: schema.accounts, veh: schema.vehicles })
    .from(schema.invoiceLines)
    .innerJoin(schema.vatCodes, eq(schema.vatCodes.id, schema.invoiceLines.vatCodeId))
    .innerJoin(schema.accounts, eq(schema.accounts.id, schema.invoiceLines.accountId))
    .leftJoin(schema.vehicles, eq(schema.vehicles.id, schema.invoiceLines.vehicleId))
    .where(eq(schema.invoiceLines.invoiceId, id))
    .orderBy(asc(schema.invoiceLines.position));

  // A számlához tartozó összes főkönyvi tétel (könyvelés, rendezések, stornók)
  const entries = inv.status === "draft" ? [] : await db
    .select()
    .from(schema.journalEntries)
    .where(and(eq(schema.journalEntries.companyId, cid), eq(schema.journalEntries.sourceId, id), or(eq(schema.journalEntries.sourceType, "invoice"), eq(schema.journalEntries.sourceType, "payment"), eq(schema.journalEntries.sourceType, "storno"))))
    .orderBy(asc(schema.journalEntries.id));
  const entryLines = entries.length
    ? await db
        .select({ l: schema.journalLines, code: schema.accounts.code, name: schema.accounts.name })
        .from(schema.journalLines)
        .innerJoin(schema.accounts, eq(schema.accounts.id, schema.journalLines.accountId))
        .where(inArray(schema.journalLines.entryId, entries.map((e) => e.id)))
        .orderBy(asc(schema.journalLines.id))
    : [];
  const pays = await invoicePayments(id);
  const open = inv.status === "posted" ? await invoiceOpenAmount(db, id) : null;
  const moneyAccounts = await db
    .select()
    .from(schema.accounts)
    .where(and(eq(schema.accounts.companyId, cid), like(schema.accounts.code, "38%"), eq(schema.accounts.isPosting, true)))
    .orderBy(asc(schema.accounts.code));
  const [audit] = await invoiceAudit(cid, { ids: [id] });
  const isMarginSale = inv.direction === "out" && lines.some((x) => x.vat.kind === "margin");

  return (
    <>
      <div className="topbar">
        <h1>{inv.direction === "out" ? "Vevőszámla" : "Szállítói számla"} {inv.invoiceNumber} <span className={`badge ${inv.status}`}>{statusHu[inv.status]}</span></h1>
        <div className="row no-print">
          <Link className="btn" href={`/c/${cid}/invoices?dir=${inv.direction}`}>← Lista</Link>
          {canWrite && inv.status === "draft" && (
            <>
              <Link className="btn" href={`/c/${cid}/invoices/${id}/edit`}>Szerkesztés</Link>
              <form action={postInvoiceAction}><input type="hidden" name="cid" value={cid} /><input type="hidden" name="id" value={id} /><button className="primary">Könyvelés</button></form>
              <form action={cancelInvoiceAction}><input type="hidden" name="cid" value={cid} /><input type="hidden" name="id" value={id} /><button className="danger">Piszkozat törlése</button></form>
            </>
          )}
        </div>
      </div>
      <Flash error={sp.error} ok={sp.ok} />

      {audit && (
        <div className={`card check-panel${audit.check.checked ? " ok" : ""}`} style={{ marginBottom: 14 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>
              {audit.check.checked ? `✓ Ellenőrizve – ${audit.check.by ?? ""}, ${audit.check.at ? fmtDate(audit.check.at.toISOString().slice(0, 10)) : ""}`
                : audit.check.stale ? "Az ellenőrzés óta módosult – nézd át újra" : "Nincs ellenőrizve"}
            </strong>
            {canWrite && inv.status !== "cancelled" && (
              <form action={toggleInvoiceCheckAction} className="no-print">
                <input type="hidden" name="cid" value={cid} /><input type="hidden" name="id" value={id} /><input type="hidden" name="back" value={`/c/${cid}/invoices/${id}`} />
                <input type="hidden" name="on" value={audit.check.checked ? "0" : "1"} />
                <button className={audit.check.checked ? undefined : "primary"}>{audit.check.checked ? "Pipa visszavonása" : "Megjelölés ellenőrzöttként"}</button>
              </form>
            )}
          </div>
          {audit.flags.length > 0 && (
            <ul className="flag-list">
              {audit.flags.map((f) => <li key={f.code + f.text} className={f.level}>{f.level === "warn" ? "⚠ " : "ℹ "}{f.text}</li>)}
            </ul>
          )}
          {canWrite ? (
            <form action={saveInvoiceCheckNoteAction} className="form-grid no-print" style={{ marginTop: 10 }}>
              <input type="hidden" name="cid" value={cid} /><input type="hidden" name="id" value={id} />
              <label>Bizonylat hivatkozás (Gmail / Drive / számlázz.hu)<input name="docUrl" defaultValue={audit.check.docUrl ?? ""} placeholder="https://…" /></label>
              <label style={{ gridColumn: "span 2" }}>Ellenőrzési megjegyzés<input name="note" defaultValue={audit.check.note ?? ""} placeholder="pl. számla bekérve" /></label>
              <div style={{ alignSelf: "end" }}><button>Mentés</button></div>
            </form>
          ) : audit.check.note ? <p>{audit.check.note}</p> : null}
          {audit.check.docUrl && <p style={{ margin: "8px 0 0" }}><a href={audit.check.docUrl} target="_blank" rel="noreferrer">Eredeti bizonylat megnyitása ↗</a></p>}
        </div>
      )}

      <div className="grid cols-3">
        <div className="card">
          <div className="muted">Partner</div>
          <div><strong>{partner.name}</strong></div>
          <div className="mono">{partner.taxNumber ?? partner.euVatNumber}</div>
          <div className="muted">{partner.address} {partner.country !== "HU" ? `(${partner.country})` : ""}</div>
        </div>
        <div className="card">
          <div>Kelte: {fmtDate(inv.issueDate)}</div>
          <div>Teljesítés: {fmtDate(inv.fulfillmentDate)}</div>
          <div>Határidő: {fmtDate(inv.dueDate)}</div>
          <div>Fizetési mód: {{ transfer: "átutalás", cash: "készpénz", card: "bankkártya" }[inv.paymentMethod] ?? inv.paymentMethod}</div>
        </div>
        <div className="card">
          <div>Nettó: {fmtHuf(inv.netHuf)} Ft</div>
          <div>ÁFA: {fmtHuf(inv.vatHuf)} Ft</div>
          <div><strong>Végösszeg: {fmtMoney(inv.grossFx, inv.currency)}</strong></div>
          {inv.currency !== "HUF" && (
            <div className="muted">
              Árfolyam: {String(inv.exchangeRate).replace(".", ",")} ({inv.rateSource === "manual" ? "kézi" : `MNB ${fmtDate(inv.rateDate)}`}{inv.periodic ? ", időszakos" : ""}) → {fmtHuf(inv.grossHuf)} Ft
            </div>
          )}
          {open && <div style={{ marginTop: 6 }}>Nyitott: <strong>{fmtMoney(open.openFx, inv.currency)}</strong></div>}
        </div>
      </div>
      {isMarginSale && <p className="muted">Számlán feltüntetendő: „Különbözet szerinti szabályozás – használt cikkek”. Az ÁFA összege a számlán nem szerepel.</p>}

      <h2>Tételek</h2>
      <table>
        <thead><tr><th>#</th><th>Megnevezés</th><th>Gépkocsi</th><th className="num">Menny.</th><th className="num">Egységár</th><th>ÁFA</th><th>Ellenszámla</th><th className="num">Nettó Ft</th><th className="num">ÁFA Ft</th><th className="num">Bruttó Ft</th></tr></thead>
        <tbody>
          {lines.map(({ l, vat, acc, veh }) => (
            <tr key={l.id}>
              <td>{l.position}</td>
              <td>{l.description}{l.marginPurchaseHuf !== null && <div className="muted" style={{ fontSize: 12 }}>beszerzési ár (különbözeti alap): {fmtHuf(l.marginPurchaseHuf)} Ft · árrés: {fmtHuf(Number(l.grossHuf) - Number(l.marginPurchaseHuf))} Ft</div>}</td>
              <td>{veh ? `${veh.make} ${veh.model} ${veh.plate ?? ""}` : ""}</td>
              <td className="num">{l.quantity}</td>
              <td className="num">{fmtMoney(l.unitPrice, inv.currency)}</td>
              <td>{vat.code}</td>
              <td className="mono">{acc.code}</td>
              <td className="num">{fmtHuf(l.netHuf)}</td>
              <td className="num">{fmtHuf(l.vatHuf)}</td>
              <td className="num">{fmtHuf(l.grossHuf)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {inv.status === "posted" && canWrite && (
        <>
          <h2>Pénzügyi rendezés</h2>
          {open && open.openFx > 0 && (
            <PaymentForm
              cid={cid}
              invoiceId={id}
              currency={inv.currency}
              direction={inv.direction}
              openFx={open.openFx}
              today={today()}
              moneyAccounts={moneyAccounts.map((a) => ({ id: a.id, code: a.code, name: a.name, currency: a.currency }))}
            />
          )}
        </>
      )}
      {pays.length > 0 && (
        <table style={{ marginTop: 12 }}>
          <thead><tr><th>Dátum</th><th>Pénzeszköz</th><th className="num">Összeg</th><th className="num">Árfolyam</th><th className="num">Ft</th><th>Tétel</th><th></th></tr></thead>
          <tbody>
            {pays.map((x) => (
              <tr key={x.p.id} className={x.reversed ? "reversed" : undefined}>
                <td>{fmtDate(x.p.date)}</td><td>{x.accountCode} {x.accountName}</td>
                <td className="num">{fmtMoney(x.p.amountFx, inv.currency)}</td><td className="num">{inv.currency !== "HUF" ? x.p.fxRate : ""}</td>
                <td className="num">{fmtHuf(x.p.amountHuf)}</td><td className="mono">{x.entryNumber}</td>
                <td>{!x.reversed && canWrite && (
                  <form action={reversePaymentAction}><input type="hidden" name="cid" value={cid} /><input type="hidden" name="invoiceId" value={id} /><input type="hidden" name="paymentId" value={x.p.id} /><button className="danger">Sztornó</button></form>
                )}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {entries.length > 0 && (
        <>
          <h2>Főkönyvi tételek</h2>
          <table>
            <thead><tr><th>Tétel</th><th>Dátum</th><th>Számla</th><th>Szöveg</th><th className="num">Tartozik</th><th className="num">Követel</th></tr></thead>
            <tbody>
              {entries.map((e) => (
                entryLines.filter((x) => x.l.entryId === e.id).map((x, k) => (
                  <tr key={x.l.id} className={e.reversedById ? "reversed" : undefined}>
                    <td className="mono">{k === 0 ? e.number : ""}</td>
                    <td>{k === 0 ? fmtDate(e.date) : ""}</td>
                    <td className="mono" title={x.name}>{x.code} <span className="muted">{x.name}</span></td>
                    <td>{x.l.description}</td>
                    <td className="num">{x.l.debit ? fmtHuf(x.l.debit) : ""}</td>
                    <td className="num">{x.l.credit ? fmtHuf(x.l.credit) : ""}</td>
                  </tr>
                ))
              ))}
            </tbody>
          </table>
        </>
      )}

      {inv.status === "posted" && canWrite && (
        <form action={cancelInvoiceAction} className="row no-print" style={{ marginTop: 24 }}>
          <input type="hidden" name="cid" value={cid} /><input type="hidden" name="id" value={id} />
          <label>Sztornó dátuma<input type="date" name="date" defaultValue={today()} /></label>
          <button className="danger" style={{ alignSelf: "end" }}>Számla sztornózása</button>
        </form>
      )}
    </>
  );
}
