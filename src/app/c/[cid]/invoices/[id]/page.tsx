import Link from "next/link";
import { needsApproval, canApprove } from "@/lib/approval-calc";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, inArray, like, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCompany } from "@/lib/auth";
import { invoiceOpenAmount } from "@/lib/ledger";
import { invoicePayments } from "@/lib/reports";
import { postInvoiceAction, cancelInvoiceAction, voidInvoiceAction, renameInvoiceLineAction, reopenInvoiceAction, editPaymentAction, reversePaymentAction, toggleInvoiceCheckAction, saveInvoiceCheckNoteAction, linkEntryAction, offsetInvoiceAction, approveInvoiceAction } from "../../actions";
import { matchCandidates, offsetCandidates } from "@/lib/matching";
import { invoiceAudit } from "@/lib/invoice-audit";
import { vehicleIdent, vehicleTitle } from "@/lib/vehicle-id";
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
  const { role, company } = await requireCompany(cid);
  const canWrite = role !== "viewer";
  const [row] = await db
    .select({ i: schema.invoices, partner: schema.partners })
    .from(schema.invoices)
    .innerJoin(schema.partners, eq(schema.partners.id, schema.invoices.partnerId))
    .where(and(eq(schema.invoices.id, id), eq(schema.invoices.companyId, cid)));
  if (!row) notFound();
  const { i: inv, partner } = row;
  const [approver] = inv.approvedBy ? await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, inv.approvedBy)) : [];
  const approverName = approver?.name ?? null;

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
  const [chk] = await db.select({ at: schema.invoiceChecks.checkedAt }).from(schema.invoiceChecks).where(eq(schema.invoiceChecks.invoiceId, id));
  const locked = !!chk?.at;
  const invEntry = entries.find((e) => e.id === inv.journalEntryId);
  const canReopen = inv.status === "posted" && canWrite && !locked && !invEntry?.checkedAt && !invEntry?.reversedById;
  const entryById = new Map(entries.map((e) => [e.id, e]));
  const history = await db
    .select({ h: schema.journalLineChanges, user: schema.users.name })
    .from(schema.journalLineChanges).leftJoin(schema.users, eq(schema.users.id, schema.journalLineChanges.userId))
    .where(entries.length ? or(eq(schema.journalLineChanges.invoiceId, id), inArray(schema.journalLineChanges.entryId, entries.map((e) => e.id))) : eq(schema.journalLineChanges.invoiceId, id))
    .orderBy(desc(schema.journalLineChanges.changedAt));
  const open = inv.status === "posted" ? await invoiceOpenAmount(db, id) : null;
  const moneyAccounts = await db
    .select()
    .from(schema.accounts)
    .where(and(eq(schema.accounts.companyId, cid), like(schema.accounts.code, "38%"), eq(schema.accounts.isPosting, true)))
    .orderBy(asc(schema.accounts.code));
  const [audit] = await invoiceAudit(cid, { ids: [id] });
  const isMarginSale = inv.direction === "out" && lines.some((x) => x.vat.kind === "margin");
  // v2.2 – helyesbítések, párosítás, beszámítás
  const [corrected] = inv.correctsInvoiceId ? await db.select({ id: schema.invoices.id, number: schema.invoices.invoiceNumber }).from(schema.invoices).where(eq(schema.invoices.id, inv.correctsInvoiceId)) : [];
  const corrections = await db.select({ id: schema.invoices.id, number: schema.invoices.invoiceNumber, status: schema.invoices.status, gross: schema.invoices.grossFx }).from(schema.invoices).where(and(eq(schema.invoices.companyId, cid), eq(schema.invoices.correctsInvoiceId, id)));
  const openNonZero = !!open && Math.abs(open.openFx) >= 0.005;
  const match = openNonZero && canWrite ? await matchCandidates(cid, id) : { candidates: [] };
  const offsets = openNonZero && canWrite ? await offsetCandidates(cid, id) : [];

  return (
    <>
      <div className="topbar">
        <h1>{inv.direction === "out" ? "Vevőszámla" : "Szállítói számla"} {inv.invoiceNumber} {inv.voidedAt ? <span className="badge cancelled">rontott</span> : <span className={`badge ${inv.status}`}>{statusHu[inv.status]}</span>}</h1>
        <div className="row no-print">
          <Link className="btn" href={`/c/${cid}/invoices?dir=${inv.direction}`}>← Lista</Link>
          {[...new Set(lines.filter((x) => x.vat.kind === "margin" && x.veh).map((x) => x.veh!.id))].map((vid) => (
            <Link key={vid} className="btn" href={`/c/${cid}/vehicles/${vid}/karton`}>Különbözeti ÁFA karton{lines.filter((x) => x.veh).length > 1 ? ` (${vehicleIdent(lines.find((x) => x.veh?.id === vid)!.veh!) || vid})` : ""}</Link>
          ))}
          {canWrite && inv.status === "posted" && !inv.correctsInvoiceId && (
            <Link className="btn" href={`/c/${cid}/invoices/new?corrects=${id}`}>Helyesbítő számla</Link>
          )}
          {canWrite && inv.status === "draft" && (
            <>
              {!inv.voidedAt && <Link className="btn" href={`/c/${cid}/invoices/${id}/edit`}>Szerkesztés</Link>}
              {!inv.voidedAt && <form action={postInvoiceAction}><input type="hidden" name="cid" value={cid} /><input type="hidden" name="id" value={id} /><button className="primary">Könyvelés</button></form>}
              <form action={voidInvoiceAction}><input type="hidden" name="cid" value={cid} /><input type="hidden" name="id" value={id} /><input type="hidden" name="on" value={inv.voidedAt ? "0" : "1"} />
                <button title="Elrontott papírszámla: a sorszám miatt megmarad, de nem könyvelendő és nem teendő">{inv.voidedAt ? "Rontott jelölés visszavonása" : "Rontottnak jelölés"}</button></form>
              <form action={cancelInvoiceAction}><input type="hidden" name="cid" value={cid} /><input type="hidden" name="id" value={id} /><button className="danger">Piszkozat törlése</button></form>
            </>
          )}
        </div>
      </div>
      <Flash error={sp.error} ok={sp.ok} />

      {/* v7.5.0 – jóváhagyás kifizetés előtt */}
      {inv.direction === "in" && inv.status === "posted" && (needsApproval(company.settings.approval, inv) || inv.approvedAt) && (
        <div className={`card check-panel${inv.approvedAt ? " ok" : ""}`} style={{ marginBottom: 14 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>{inv.approvedAt ? `✓ Fizetésre jóváhagyva – ${approverName ?? ""}, ${fmtDate(inv.approvedAt.toISOString().slice(0, 10))}` : "Fizetés előtt jóváhagyásra vár"}</strong>
            {canApprove(role) && (
              <form action={approveInvoiceAction}>
                <input type="hidden" name="cid" value={cid} /><input type="hidden" name="id" value={id} />
                {inv.approvedAt ? <><input type="hidden" name="undo" value="1" /><button>Jóváhagyás visszavonása</button></> : <button className="primary">Jóváhagyom a kifizetést</button>}
              </form>
            )}
          </div>
          {!inv.approvedAt && !canApprove(role) && <p className="muted" style={{ margin: "6px 0 0" }}>A tulajdonos vagy az ügyvezető (CEO) hagyhatja jóvá; addig a számla nem rendezhető.</p>}
        </div>
      )}

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
      {corrected && <p>Helyesbítő számla – helyesbíti: <Link href={`/c/${cid}/invoices/${corrected.id}`}>{corrected.number}</Link></p>}
      {corrections.length > 0 && (
        <p>Helyesbítések: {corrections.map((c, k) => <span key={c.id}>{k ? ", " : ""}<Link href={`/c/${cid}/invoices/${c.id}`}>{c.number}</Link> ({fmtMoney(c.gross, inv.currency)}{c.status !== "posted" ? `, ${statusHu[c.status]}` : ""})</span>)}</p>
      )}
      {isMarginSale && <p className="muted">Számlán feltüntetendő: „Különbözet szerinti szabályozás – használt cikkek”. Az ÁFA összege a számlán nem szerepel.</p>}

      {canReopen && (
        <form action={reopenInvoiceAction} className="row no-print" style={{ margin: "12px 0", gap: 10, alignItems: "center" }}>
          <input type="hidden" name="cid" value={cid} /><input type="hidden" name="id" value={id} />
          <button>Számla javítása</button>
          <span className="muted">Újranyitja szerkesztésre (partner, dátum, tételek, összegek); újrakönyveléskor ugyanazt a tételszámot kapja. A rendezések megmaradnak.</span>
        </form>
      )}
      {inv.status === "posted" && locked && <p className="muted no-print">Ellenőrzöttnek jelölve – a számla és a rendezései zároltak. Javításhoz előbb vedd le a jelölést.</p>}

      <h2>Tételek</h2>
      <table>
        <thead><tr><th>#</th><th>Megnevezés</th><th>Gépkocsi</th><th className="num">Menny.</th><th className="num">Egységár</th><th>ÁFA</th><th>Ellenszámla</th><th className="num">Nettó Ft</th><th className="num">ÁFA Ft</th><th className="num">Bruttó Ft</th></tr></thead>
        <tbody>
          {lines.map(({ l, vat, acc, veh }) => (
            <tr key={l.id}>
              <td>{l.position}</td>
              <td>{l.description}
                {inv.status === "posted" && canWrite && (
                  <details className="fc-more">
                    <summary>megnevezés javítása</summary>
                    <form action={renameInvoiceLineAction} className="row" style={{ gap: 6, marginTop: 6 }}>
                      <input type="hidden" name="cid" value={cid} /><input type="hidden" name="id" value={id} /><input type="hidden" name="lineId" value={l.id} />
                      <input name="description" defaultValue={l.description} required style={{ minWidth: 240 }} />
                      <button>Mentés</button>
                    </form>
                  </details>
                )}
                {l.marginPurchaseHuf !== null && <div className="muted" style={{ fontSize: 12 }}>beszerzési ár (különbözeti alap): {fmtHuf(l.marginPurchaseHuf)} Ft · árrés: {fmtHuf(Number(l.grossHuf) - Number(l.marginPurchaseHuf))} Ft</div>}</td>
              <td>{veh ? vehicleTitle(veh) : ""}</td>
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
          {open && open.openFx < 0 && <p className="muted">Jóváíró (negatív) számla: visszatérítésnél negatív összeget adj meg, vagy számítsd be egy nyitott számlával.</p>}
          {openNonZero && (
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
          {openNonZero && match.candidates.length > 0 && (
            <details className="card" style={{ marginTop: 12 }} open={match.candidates.some((c) => c.exact)}>
              <summary><strong>Párosítás meglévő könyvelési tétellel</strong> <span className="muted">– ha a fizetést kézi (bank / pénztár / vegyes) tétellel könyvelted ({match.candidates.length} jelölt)</span></summary>
              <table style={{ marginTop: 8 }}>
                <thead><tr><th>Tétel</th><th>Dátum</th><th>Szöveg</th><th className="num">Összeg</th><th className="num">Párosítható</th><th></th></tr></thead>
                <tbody>
                  {match.candidates.map((c) => (
                    <tr key={c.entryId}>
                      <td className="mono">{c.number}{c.exact && <span className="badge posted" style={{ marginLeft: 6 }}>egyező összeg</span>}{!c.partnerMatch && <span className="badge" style={{ marginLeft: 6 }} title="A tételsorban nincs partner – párosításkor a számla partnere kerül rá">partner nélkül</span>}</td>
                      <td>{fmtDate(c.date)}</td><td>{c.description}</td>
                      <td className="num">{fmtHuf(c.amount)}</td><td className="num">{fmtHuf(c.remaining)}</td>
                      <td>
                        <form action={linkEntryAction} className="row" style={{ gap: 6 }}>
                          <input type="hidden" name="cid" value={cid} /><input type="hidden" name="id" value={id} /><input type="hidden" name="entryId" value={c.entryId} />
                          <input name="amount" className="num" style={{ width: 110 }} defaultValue={String(Math.min(c.remaining, Math.abs(open!.openFx)))} aria-label="Párosított összeg" />
                          <button className="primary">Párosítás</button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
          {openNonZero && offsets.length > 0 && (
            <details className="card" style={{ marginTop: 12 }}>
              <summary><strong>Beszámítás</strong> <span className="muted">– ellentétes előjelű nyitott számla ugyanennél a partnernél ({offsets.length})</span></summary>
              {offsets.map((o) => (
                <form key={o.id} action={offsetInvoiceAction} className="row" style={{ gap: 8, marginTop: 8, alignItems: "end" }}>
                  <input type="hidden" name="cid" value={cid} /><input type="hidden" name="id" value={id} /><input type="hidden" name="otherId" value={o.id} />
                  <span><Link href={`/c/${cid}/invoices/${o.id}`}>{o.number}</Link> · nyitott {fmtHuf(o.open)} Ft</span>
                  <label>Összeg<input name="amount" className="num" style={{ width: 110 }} defaultValue={String(Math.min(Math.abs(o.open), Math.abs(open!.openFx)))} /></label>
                  <label>Dátum<input type="date" name="date" defaultValue={today()} /></label>
                  <button>Beszámítás könyvelése</button>
                </form>
              ))}
            </details>
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
                <td className="num">{fmtHuf(x.p.amountHuf)}</td><td className="mono">{x.entryNumber}{x.p.kind !== "payment" && <span className="badge" style={{ marginLeft: 6 }}>{x.p.kind === "link" ? "párosítva" : "beszámítás"}</span>}</td>
                <td>{!x.reversed && canWrite && (
                  <div className="row" style={{ gap: 6, alignItems: "flex-start" }}>
                    {x.p.kind === "payment" && !locked && !(x.p.journalEntryId && entryById.get(x.p.journalEntryId)?.checkedAt) && (
                      <details className="fc-more">
                        <summary>javítás</summary>
                        <form action={editPaymentAction} className="row" style={{ gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                          <input type="hidden" name="cid" value={cid} /><input type="hidden" name="invoiceId" value={id} /><input type="hidden" name="paymentId" value={x.p.id} />
                          <input type="date" name="date" defaultValue={x.p.date} required aria-label="Dátum" />
                          <select name="moneyAccountId" defaultValue={x.p.moneyAccountId} aria-label="Pénzeszköz">
                            {moneyAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
                          </select>
                          <input name="amountFx" className="num" style={{ width: 120 }} defaultValue={Number(x.p.amountFx)} required aria-label={`Összeg (${inv.currency})`} />
                          {inv.currency !== "HUF" && <input name="moneyHuf" className="num" style={{ width: 120 }} defaultValue={Number(x.p.amountHuf)} placeholder="Ft (forintszámlánál)" aria-label="Forint összeg" />}
                          <button>Mentés</button>
                        </form>
                      </details>
                    )}
                    <form action={reversePaymentAction}><input type="hidden" name="cid" value={cid} /><input type="hidden" name="invoiceId" value={id} /><input type="hidden" name="paymentId" value={x.p.id} /><button className="danger">{x.p.kind === "link" ? "Párosítás bontása" : "Sztornó"}</button></form>
                  </div>
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

      {history.length > 0 && (
        <>
          <h2>Módosítások</h2>
          <table>
            <thead><tr><th>Időpont</th><th>Felhasználó</th><th>Esemény</th><th>Régi</th><th>Új</th></tr></thead>
            <tbody>
              {history.map(({ h, user }) => (
                <tr key={h.id}>
                  <td>{new Date(h.changedAt).toLocaleString("hu-HU", { timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                  <td>{user ?? "–"}</td>
                  <td>{({ invoice_reopen: "Újranyitva javításra", invoice_repost: "Újrakönyvelve", payment_edit: "Rendezés javítva", invoice_line: "Tétel megnevezése", description: "Könyvelési sor szövege" } as Record<string, string>)[h.field] ?? h.field}</td>
                  <td className="muted">{h.oldValue ?? "–"}</td><td>{h.newValue ?? "–"}</td>
                </tr>
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
