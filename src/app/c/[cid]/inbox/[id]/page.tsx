import Link from "next/link";
import { isPrivate, lineDefaults } from "@/lib/entity";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCompany } from "@/lib/auth";
import { formOptions } from "@/lib/options";
import { openItems } from "@/lib/reports";
import { Flash } from "@/components/Flash";
import { SubmitButton } from "@/components/SubmitButton";
import { fmtHuf } from "@/lib/money";
import { fmtDate } from "@/lib/dates";
import { bookInvoiceAction, reprocessAction, ignoreDocAction, statementRowAction, repairStatementAction } from "../actions";

const STATUS_HU: Record<string, string> = { new: "új", extracted: "kiolvasva", review: "jóváhagyásra vár", booked: "lekönyvelve", duplicate: "már bent volt", ignored: "kihagyva", error: "hiba" };

export default async function InboxDocPage({ params, searchParams }: { params: Promise<{ cid: string; id: string }>; searchParams: Promise<Record<string, string>> }) {
  const p = await params;
  const cid = Number(p.cid);
  const sp = await searchParams;
  const { role, company } = await requireCompany(cid);
  const ld = lineDefaults(company);
  const canWrite = role !== "viewer";
  const [d] = await db.select().from(schema.inboxDocuments).where(and(eq(schema.inboxDocuments.id, Number(p.id)), eq(schema.inboxDocuments.companyId, cid)));
  if (!d) notFound();
  const x = d.extracted;
  const prop = d.proposal;
  const inv = prop?.invoice ?? null;
  const opts = await formOptions(cid, inv?.lines.map((l) => l.vehicleId ?? 0).filter(Boolean) ?? []);
  const fileUrl = `/c/${cid}/inbox/${d.id}/file`;
  const isImg = d.mime.startsWith("image/");
  const blank = { description: "", quantity: 1, unitPrice: 0, accountCode: inv?.direction === "out" ? (isPrivate(company) ? ld.outAcc : "911") : "529", vatCode: inv?.direction === "out" ? ld.outVat : ld.inVat, vehicleId: null, newVehicle: false };
  // két üres sor, hogy hiányzó tételt is fel lehessen venni
  const rows = inv ? [...inv.lines, ...(canWrite && d.status !== "booked" ? [blank, blank] : [])] : [];
  const METHOD_HU: Record<string, string> = { table: "bankkivonat-export (CSV / Excel)", text: "PDF szövege, szabályok alapján", ocr: "Google szövegfelismerés + szabályok", ai: "AI (Claude)", none: "nem olvasható – kézi kitöltés" };
  const editable = canWrite && !["booked"].includes(d.status);
  const [openIn, openOut] = prop?.statement ? await Promise.all([openItems(cid, "in"), openItems(cid, "out")]) : [[], []];

  return (
    <>
      <div className="topbar">
        <h1>Bizonylat #{d.id} <span className={`badge ${d.status === "booked" ? "posted" : d.status === "review" || d.status === "error" ? "soon" : "draft"}`}>{STATUS_HU[d.status]}</span></h1>
        <div className="row">
          <Link className="btn" href={`/c/${cid}/inbox`}>← Lista</Link>
          {d.sourceUrl && <a className="btn" href={d.sourceUrl} target="_blank" rel="noreferrer">Eredeti ({d.source === "gmail" ? "Gmail" : "Drive"}) ↗</a>}
          {d.invoiceId && <Link className="btn primary" href={`/c/${cid}/invoices/${d.invoiceId}`}>A lekönyvelt számla</Link>}
        </div>
      </div>
      <Flash error={sp.error} ok={sp.ok} />

      <div className="inbox-split">
        <div className="preview">
          {isImg ? <img src={fileUrl} alt={d.filename} /> : /\.(csv|xlsx|xls)$/i.test(d.filename) ? <div className="card"><p style={{ marginTop: 0 }}>Táblázatos bankkivonat-export.</p><a className="btn" href={fileUrl} download={d.filename}>Letöltés</a></div> : <iframe src={fileUrl} title={d.filename} />}
          <p className="muted" style={{ fontSize: 12 }}>{d.filename}{d.emailSubject ? ` · ${d.emailSubject}` : ""}{d.emailFrom ? ` · ${d.emailFrom}` : ""}</p>
        </div>

        <div>
          {d.error && <div className="card fc-warn" style={{ marginBottom: 12 }}>⚠ {d.error}</div>}
          {prop && prop.issues.length > 0 && (
            <div className="card fc-warn" style={{ marginBottom: 12 }}>
              <strong>Ezért nem könyvelődött automatikusan:</strong>
              <ul>{prop.issues.map((i, k) => <li key={k}>{i}</li>)}</ul>
            </div>
          )}
          {prop?.basis && <p className="muted">Javaslat alapja: {prop.basis}{x?.method ? ` · kiolvasás: ${METHOD_HU[x.method] ?? x.method}` : ""}{x?.confidence != null ? ` · biztonság: ${Math.round(x.confidence * 100)}%` : ""}</p>}

          {inv && (
            <form action={bookInvoiceAction} className="card">
              <input type="hidden" name="cid" value={cid} /><input type="hidden" name="id" value={d.id} />
              <input type="hidden" name="lineCount" value={rows.length} />
              <div className="form-grid">
                <label>Irány<select name="direction" defaultValue={inv.direction} disabled={!editable}><option value="in">szállítói (bejövő)</option><option value="out">vevő (kimenő)</option></select></label>
                <label>Partner
                  <select name="partnerId" defaultValue={inv.partner.id ? String(inv.partner.id) : "new"} disabled={!editable}>
                    <option value="new">+ új partner: {inv.partner.name}</option>
                    {opts.partners.map((pp) => <option key={pp.id} value={pp.id}>{pp.name}</option>)}
                  </select>
                </label>
                <label>Új partner neve<input name="partnerName" defaultValue={inv.partner.name} disabled={!editable} /></label>
                <label>Adószám<input name="partnerTax" defaultValue={inv.partner.taxNumber ?? ""} disabled={!editable} /></label>
                <label>Ország<input name="partnerCountry" defaultValue={inv.partner.country ?? "HU"} maxLength={2} disabled={!editable} /></label>
                <label className="check"><input type="checkbox" name="partnerPrivate" defaultChecked={inv.partner.privatePerson} disabled={!editable} /> magánszemély</label>
                <label>Számlaszám<input name="invoiceNumber" defaultValue={inv.invoiceNumber} required disabled={!editable} /></label>
                <label>Kelte<input type="date" name="issueDate" defaultValue={inv.issueDate} disabled={!editable} /></label>
                <label>Teljesítés<input type="date" name="fulfillmentDate" defaultValue={inv.fulfillmentDate} disabled={!editable} /></label>
                <label>Határidő<input type="date" name="dueDate" defaultValue={inv.dueDate ?? ""} disabled={!editable} /></label>
                <label>Fizetés módja<select name="paymentMethod" defaultValue={inv.paymentMethod} disabled={!editable}><option value="transfer">átutalás</option><option value="cash">készpénz</option><option value="card">kártya</option></select></label>
                <label>Pénznem<input name="currency" defaultValue={inv.currency} maxLength={3} disabled={!editable} /></label>
                <label className="check"><input type="checkbox" name="periodic" defaultChecked={inv.periodic} disabled={!editable} /> időszakos elszámolás</label>
              </div>

              <table className="lines-edit" style={{ marginTop: 12 }}>
                <thead><tr><th>Tétel</th><th className="num">Menny.</th><th className="num" title="Nettó egységár">Egységár</th><th>Számla</th><th>ÁFA</th><th>Gépkocsi</th><th title="Törlés">✕</th></tr></thead>
                <tbody>
                  {rows.map((l, i) => (
                    <tr key={i}>
                      <td><input name={`l${i}_desc`} defaultValue={l.description} disabled={!editable} /></td>
                      <td><input name={`l${i}_qty`} className="num" defaultValue={l.quantity} disabled={!editable} /></td>
                      <td><input name={`l${i}_unit`} className="num" defaultValue={l.unitPrice} disabled={!editable} /></td>
                      <td>
                        <select name={`l${i}_acc`} defaultValue={l.accountCode} disabled={!editable}>
                          {opts.accounts.map((a) => <option key={a.id} value={a.code}>{a.code} {a.name}</option>)}
                        </select>
                      </td>
                      <td>
                        <select name={`l${i}_vat`} defaultValue={l.vatCode} disabled={!editable}>
                          {opts.vatCodes.map((v) => <option key={v.id} value={v.code}>{v.code}</option>)}
                        </select>
                      </td>
                      <td>
                        <select name={`l${i}_vehicle`} defaultValue={l.newVehicle ? "new" : l.vehicleId ? String(l.vehicleId) : ""} disabled={!editable}>
                          <option value="">–</option>
                          <option value="new">+ új gépkocsi (alább)</option>
                          {opts.vehicles.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                        </select>
                      </td>
                      <td style={{ textAlign: "center" }}><input type="checkbox" name={`l${i}_del`} disabled={!editable} aria-label="Tétel törlése" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <details className="fc-more" open={inv.lines.some((l) => l.newVehicle)} style={{ marginTop: 10 }}>
                <summary>Új gépkocsi adatai</summary>
                <div className="form-grid" style={{ marginTop: 6 }}>
                  <label>Gyártmány<input name="vehMake" defaultValue={inv.vehicle?.make ?? x?.vehicle?.make ?? ""} disabled={!editable} /></label>
                  <label>Típus<input name="vehModel" defaultValue={inv.vehicle?.model ?? x?.vehicle?.model ?? ""} disabled={!editable} /></label>
                  <label>Rendszám<input name="vehPlate" defaultValue={inv.vehicle?.plate ?? x?.vehicle?.plate ?? ""} disabled={!editable} /></label>
                  <label>Alvázszám<input name="vehVin" defaultValue={inv.vehicle?.vin ?? x?.vehicle?.vin ?? ""} disabled={!editable} /></label>
                </div>
              </details>

              <div className="form-grid" style={{ marginTop: 10 }}>
                <label className="check"><input type="checkbox" name="payNow" defaultChecked={!!inv.payNow} disabled={!editable} /> már kifizetve (azonnali kiegyenlítés)</label>
                <label>Fizetés napja<input type="date" name="payDate" defaultValue={inv.payNow?.date ?? inv.fulfillmentDate} disabled={!editable} /></label>
                <label>Pénzeszköz
                  <select name="payAccount" defaultValue={inv.payNow?.accountCode ?? "381"} disabled={!editable}>
                    {opts.accounts.filter((a) => a.code.startsWith("38")).map((a) => <option key={a.id} value={a.code}>{a.code} {a.name}</option>)}
                  </select>
                </label>
              </div>
              {x?.totals && <p className="muted" style={{ marginTop: 8 }}>A bizonylat szerint: nettó {fmtHuf(x.totals.net ?? 0)} · ÁFA {fmtHuf(x.totals.vat ?? 0)} · bruttó {fmtHuf(x.totals.gross ?? 0)} {x.currency ?? "HUF"}</p>}
              {editable && <div className="row" style={{ marginTop: 10 }}><SubmitButton className="primary" pendingText="Könyvelés…">Jóváhagyás és könyvelés</SubmitButton></div>}
            </form>
          )}

          {prop?.statement && (
            <div className="card">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <strong>Kivonat ({prop.statement.moneyAccountCode}) – {prop.statement.rows.length} tétel</strong>
                {editable && <form action={repairStatementAction}><input type="hidden" name="cid" value={cid} /><input type="hidden" name="id" value={d.id} /><button>Párosítás újra</button></form>}
              </div>
              <table style={{ marginTop: 8 }}>
                <thead><tr><th>Dátum</th><th className="num">Összeg</th><th>Szöveg</th><th>Könyvelés</th></tr></thead>
                <tbody>
                  {prop.statement.rows.map((r) => (
                    <tr key={r.idx} className={r.done || r.action === "skip" ? "muted" : undefined}>
                      <td className="nowrap">{fmtDate(r.date)}</td>
                      <td className="num"><span className={r.amount < 0 ? "neg" : undefined}>{fmtHuf(r.amount)}</span></td>
                      <td style={{ fontSize: 12.5 }}>{r.text}</td>
                      <td style={{ fontSize: 12.5, minWidth: 230 }}>
                        {r.done ? <>✓ {r.action === "pay_invoice" ? r.invoiceLabel : r.action === "transfer" ? "pénztárból befizetés" : `könyvelve: ${r.accountCode}`}</>
                          : r.action === "skip" ? r.reason
                          : editable ? (
                            <form action={statementRowAction} className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                              <input type="hidden" name="cid" value={cid} /><input type="hidden" name="id" value={d.id} /><input type="hidden" name="idx" value={r.idx} />
                              <select name="choice" defaultValue={r.invoiceId ? `inv:${r.invoiceId}` : r.accountCode ? `acc:${r.accountCode}` : ""} style={{ maxWidth: 220 }}>
                                <option value="">– válassz –</option>
                                <optgroup label="Nyitott számla kiegyenlítése">
                                  {(r.amount < 0 ? openIn : openOut).map((o) => <option key={o.id} value={`inv:${o.id}`}>{o.partnerName} {o.invoiceNumber} ({fmtHuf(o.openFx)} {o.currency})</option>)}
                                </optgroup>
                                <optgroup label="Könyvelés számlára">
                                  {opts.accounts.filter((a) => /^(5|8|9|4|1)/.test(a.code)).map((a) => <option key={a.id} value={`acc:${a.code}`}>{a.code} {a.name}</option>)}
                                </optgroup>
                                <option value="cashin">készpénz befizetése a pénztárból</option>
                                <option value="skip">kihagyás (már könyvelve / nem kell)</option>
                              </select>
                              <button>OK</button>
                            </form>
                          ) : r.reason}
                        {!r.done && r.reason && r.action !== "skip" && <div className="muted">{r.reason}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!inv && !prop?.statement && x && (
            <div className="card"><p style={{ marginTop: 0 }}>{prop?.issues.join(" ") || "Nincs könyvelendő adat."}</p></div>
          )}

          {editable && (
            <div className="row" style={{ marginTop: 12 }}>
              <form action={reprocessAction}><input type="hidden" name="cid" value={cid} /><input type="hidden" name="id" value={d.id} /><button>Javaslat újraszámolása</button></form>
              <form action={reprocessAction}><input type="hidden" name="cid" value={cid} /><input type="hidden" name="id" value={d.id} /><input type="hidden" name="reread" value="1" /><button>Újraolvasás</button></form>
              <form action={ignoreDocAction}><input type="hidden" name="cid" value={cid} /><input type="hidden" name="id" value={d.id} /><button className="link">kihagyás</button></form>
            </div>
          )}

          {x && (
            <details className="fc-more" style={{ marginTop: 14 }}>
              <summary>Kiolvasott adatok</summary>
              <pre style={{ fontSize: 11.5, whiteSpace: "pre-wrap", background: "var(--surface-2)", padding: 10, borderRadius: 6 }}>{JSON.stringify({ ...x, rawText: undefined }, null, 2)}</pre>
            </details>
          )}
          {x?.rawText && (
            <details className="fc-more" style={{ marginTop: 8 }}>
              <summary>A bizonylat szövege</summary>
              <pre style={{ fontSize: 11.5, whiteSpace: "pre-wrap", background: "var(--surface-2)", padding: 10, borderRadius: 6 }}>{x.rawText}</pre>
            </details>
          )}
        </div>
      </div>
    </>
  );
}
