import { and, asc, eq, like } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCompany } from "@/lib/auth";
import { memberLoans } from "@/lib/member-loans";
import { memberLoanAction, extendLoanAction } from "../actions";
import { Flash } from "@/components/Flash";
import { fmtHuf } from "@/lib/money";
import { fmtDate, today, addDaysIso } from "@/lib/dates";

const statusClass: Record<string, string> = { "Lejárt": "overdue", "Hamarosan lejár": "soon", "Nyitott": "reserved", "Rendezve": "posted" };

export default async function MemberLoansPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  const { role } = await requireCompany(cid);
  const data = await memberLoans(cid);
  const partners = await db.select().from(schema.partners).where(eq(schema.partners.companyId, cid)).orderBy(asc(schema.partners.name));
  const money = await db.select().from(schema.accounts).where(and(eq(schema.accounts.companyId, cid), like(schema.accounts.code, "38%"), eq(schema.accounts.isPosting, true))).orderBy(asc(schema.accounts.code));
  const memberIds = new Set(data.members.map((m) => m.partnerId));
  const t = today();
  const canWrite = role !== "viewer";

  return (
    <>
      <h1>Tagi kölcsön</h1>
      <Flash error={sp.error} ok={sp.ok} />
      <div className="grid cols-3">
        <div className="card stat primary"><div className="label">Tagok felé fennálló tartozás</div><div className="value">{fmtHuf(data.total)}<small>Ft</small></div></div>
        <div className="card stat"><div className="label">Lejárt, vissza nem fizetett</div><div className={`value${data.overdue > 0 ? " neg" : ""}`}>{fmtHuf(data.overdue)}<small>Ft</small></div></div>
        <div className="card stat"><div className="label">30 napon belül lejár</div><div className="value">{fmtHuf(data.dueSoon)}<small>Ft</small></div></div>
      </div>

      {canWrite && (
        <>
          <h2>Új befizetés vagy visszafizetés</h2>
          <form action={memberLoanAction} className="card form-grid">
            <input type="hidden" name="cid" value={cid} />
            <label>Tag
              <select name="partnerId" required defaultValue={data.members[0]?.partnerId ?? ""}>
                <option value="">– válassz –</option>
                {partners.filter((p) => memberIds.has(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                <optgroup label="Többi partner">
                  {partners.filter((p) => !memberIds.has(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </optgroup>
              </select>
            </label>
            <label>Típus
              <select name="kind" defaultValue="loan">
                <option value="loan">Befizetés (a tag kölcsönt ad)</option>
                <option value="repayment">Visszafizetés (a cég visszaad)</option>
              </select>
            </label>
            <label>Dátum<input type="date" name="date" defaultValue={t} required /></label>
            <label>Összeg (Ft)<input name="amount" className="num" required /></label>
            <label>Pénzeszköz
              <select name="moneyAccountId">
                {money.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
              </select>
            </label>
            <label>Deviza összeg (csak devizás számlánál)<input name="amountFx" className="num" placeholder="pl. 1000" /></label>
            <label>Lejárat (befizetésnél)<input type="date" name="dueDate" defaultValue={addDaysIso(t, 90)} /></label>
            <label>Megjegyzés<input name="note" /></label>
            <div style={{ alignSelf: "end" }}><button className="primary">Könyvelés</button></div>
          </form>
        </>
      )}

      {data.members.map((m) => (
        <section key={String(m.partnerId)}>
          <h2>{m.name}</h2>
          <p className="muted" style={{ marginTop: -4 }}>
            Befizetve {fmtHuf(m.received)} Ft, visszafizetve {fmtHuf(m.repaid)} Ft, <strong>tartozás {fmtHuf(m.balance)} Ft</strong>
            {m.overdue > 0 && <span className="neg">, ebből lejárt {fmtHuf(m.overdue)} Ft</span>}
          </p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Dátum</th><th>Tétel</th><th>Típus</th><th className="num">Összeg</th><th>Lejárat</th><th className="num">Nyitott</th><th>Állapot</th><th className="num">Egyenleg</th>{canWrite && <th className="no-print">Hosszabbítás</th>}</tr></thead>
              <tbody>
                {[...m.rows].reverse().map((r) => (
                  <tr key={r.entryId}>
                    <td>{fmtDate(r.date)}</td>
                    <td className="mono" title={r.description}>{r.number}</td>
                    <td>{r.kind === "loan" ? "Befizetés" : "Visszafizetés"}</td>
                    <td className="num">{fmtHuf(r.amount)}</td>
                    <td>{r.kind === "loan" ? fmtDate(r.dueDate) || <span className="muted">nincs megadva</span> : ""}</td>
                    <td className="num">{r.kind === "loan" ? fmtHuf(r.open) : ""}</td>
                    <td>{r.status && <span className={`badge ${statusClass[r.status]}`}>{r.status}</span>}</td>
                    <td className="num">{fmtHuf(r.balance)}</td>
                    {canWrite && (
                      <td className="no-print">
                        {r.kind === "loan" && r.open > 0 && (
                          <form action={extendLoanAction} className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                            <input type="hidden" name="cid" value={cid} />
                            <input type="hidden" name="entryId" value={r.entryId} />
                            <input type="date" name="dueDate" defaultValue={r.dueDate ?? addDaysIso(t, 60)} aria-label="Új lejárat" />
                            <button>Mentés</button>
                          </form>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      {data.members.length === 0 && <p className="muted">Még nincs tagi kölcsön. A fenti űrlappal rögzítheted az elsőt.</p>}
      <p className="muted" style={{ marginTop: 12 }}>
        A visszafizetések a legkorábbi nyitott befizetést csökkentik (FIFO). A tételek a 4791 Tagi kölcsön számlán könyvelődnek, a napló oldalán sztornózhatók.
      </p>
    </>
  );
}
