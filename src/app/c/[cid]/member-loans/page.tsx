import Link from "next/link";
import { and, asc, eq, like } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCompany } from "@/lib/auth";
import { memberLoans, type LoanRow } from "@/lib/member-loans";
import { memberLoanAction, extendLoanAction, undoExtensionAction, revalueMemberLoansAction, setLoanDueAction } from "../actions";
import { Flash } from "@/components/Flash";
import { SubmitButton } from "@/components/SubmitButton";
import { LoanBalanceChart, MaturityChart } from "@/components/LoanCharts";
import { fmtHuf, fmtMoney } from "@/lib/money";
import { fmtDate, today, addDaysIso } from "@/lib/dates";

const statusClass: Record<string, string> = { "Lejárt": "overdue", "Hamarosan lejár": "soon", "Nyitott": "reserved", "Rendezve": "posted" };
const VIEWS = { open: "Nyitott", overdue: "Lejárt", all: "Minden mozgás" } as const;
type View = keyof typeof VIEWS;

function Amount({ r }: { r: LoanRow }) {
  return (
    <>
      {fmtHuf(r.kind === "reval" ? r.signed : r.amount)}
      {r.currency && r.kind !== "reval" && <div className="muted small">{fmtMoney(r.amountFx, r.currency)}</div>}
    </>
  );
}

export default async function MemberLoansPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  const { role } = await requireCompany(cid);
  const t = today();
  const data = await memberLoans(cid, t);
  const partners = await db.select().from(schema.partners).where(eq(schema.partners.companyId, cid)).orderBy(asc(schema.partners.name));
  const money = await db.select().from(schema.accounts).where(and(eq(schema.accounts.companyId, cid), like(schema.accounts.code, "38%"), eq(schema.accounts.isPosting, true))).orderBy(asc(schema.accounts.code));
  const memberIds = new Set(data.members.map((m) => m.partnerId));
  const canWrite = role !== "viewer";
  const view: View = sp.view === "all" || sp.view === "overdue" ? sp.view : "open";
  const who = sp.member ?? "";
  const members = data.members.filter((m) => !who || String(m.partnerId) === who);
  const fxPools = data.members.flatMap((m) => m.fx.filter((f) => Math.abs(f.balanceFx) > 0.004).map((f) => ({ ...f, member: m.name })));
  const qs = (o: Record<string, string>) => new URLSearchParams({ ...(who ? { member: who } : {}), view, ...o }).toString();
  const yearEnd = `${Number(t.slice(0, 4)) - (t.slice(5) < "12-31" ? 1 : 0)}-12-31`;
  const showRow = (r: LoanRow) => view === "all" || (r.kind === "loan" && (view === "open" ? r.status !== "Rendezve" : r.status === "Lejárt"));

  return (
    <>
      <div className="topbar">
        <h1>Tagi kölcsön</h1>
        <div className="row no-print">
          <Link className="btn" href={`/c/${cid}/member-loans/statement`}>Egyenlegközlő</Link>
          <a className="btn" href={`/c/${cid}/member-loans/export`}>Excel</a>
        </div>
      </div>
      <Flash error={sp.error} ok={sp.ok} />

      <div className="grid cols-4">
        <div className="card stat primary"><div className="label">Tagok felé fennálló tartozás</div><div className="value">{fmtHuf(data.total)}<small>Ft</small></div></div>
        <div className="card stat"><div className="label">Lejárt, vissza nem fizetett</div><div className={`value${data.overdue > 0 ? " neg" : ""}`}>{fmtHuf(data.overdue)}<small>Ft</small></div></div>
        <div className="card stat"><div className="label">30 napon belül lejár</div><div className="value">{fmtHuf(data.dueSoon)}<small>Ft</small></div></div>
        <div className="card stat"><div className="label">Devizás kölcsön</div><div className="value">{fxPools.length ? fxPools.map((f) => <span key={f.member + f.currency}>{fmtMoney(f.balanceFx, f.currency)} </span>) : <span className="muted">–</span>}</div></div>
      </div>

      {data.series.length > 0 && (
        <div className="grid cols-2" style={{ marginTop: 14 }}>
          <div className="card"><LoanBalanceChart points={data.series.map((s) => ({ date: s.date, value: s.total }))} until={t} /></div>
          <div className="card">{data.ladder.length ? <MaturityChart ladder={data.ladder} /> : <p className="muted">Nincs nyitott kölcsön.</p>}</div>
        </div>
      )}

      <h2>Tagok</h2>
      <div className="grid cols-3 ml-members">
        {data.members.map((m) => (
          <Link key={String(m.partnerId)} href={`?${new URLSearchParams({ view, member: who === String(m.partnerId) ? "" : String(m.partnerId) })}`} className={`card ml-member${who === String(m.partnerId) ? " on" : ""}`}>
            <div className="ml-name">{m.name}</div>
            <div className="ml-bal">{fmtHuf(m.balance)} <small>Ft</small></div>
            <div className="ml-meta">
              <span>{m.openLoans} nyitott kölcsön</span>
              {m.nextDue && <span>következő lejárat: {fmtDate(m.nextDue)}</span>}
              {m.overdue > 0 && <span className="neg">lejárt: {fmtHuf(m.overdue)} Ft</span>}
              {m.fx.filter((f) => Math.abs(f.balanceFx) > 0.004).map((f) => <span key={f.currency}>{fmtMoney(f.balanceFx, f.currency)} · átlag {f.avgRate?.toLocaleString("hu-HU")} Ft</span>)}
            </div>
          </Link>
        ))}
      </div>

      <div className="row no-print" style={{ justifyContent: "space-between", margin: "16px 0 8px" }}>
        <div className="segmented">
          {(Object.keys(VIEWS) as View[]).map((v) => <Link key={v} href={`?${qs({ view: v })}`} className={view === v ? "on" : undefined}>{VIEWS[v]}</Link>)}
        </div>
        {who && <Link href={`?${new URLSearchParams({ view })}`}>× szűrés törlése</Link>}
      </div>

      {members.map((m) => {
        const rows = [...m.rows].reverse().filter(showRow);
        return (
          <section key={String(m.partnerId)}>
            <h3 style={{ margin: "14px 0 6px" }}>
              {m.name} <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>· befizetve {fmtHuf(m.received)} Ft · visszafizetve {fmtHuf(m.repaid)} Ft{m.revaluation ? ` · átértékelés ${fmtHuf(m.revaluation)} Ft` : ""} · <strong>tartozás {fmtHuf(m.balance)} Ft</strong></span>
              {" "}<Link className="small no-print" href={`/c/${cid}/member-loans/statement?partner=${m.partnerId}`}>egyenlegközlő</Link>
            </h3>
            <div className="table-wrap">
              <table className="ml-table">
                <thead>
                  <tr>
                    <th>Szerződés</th><th>Dátum</th><th>Típus</th><th className="num">Összeg (Ft)</th>
                    <th>Eredeti lejárat</th><th>Jelenlegi lejárat</th><th className="num">Nyitott</th><th>Állapot</th>
                    {view === "all" && <th className="num">Egyenleg</th>}
                    {canWrite && <th className="no-print">Hosszabbítás (nap)</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.entryId}>
                      <td>
                        {r.kind === "reval" ? <span className="mono muted" title={r.description}>{r.number}</span> : (r.kind === "loan" ? r.contractNo : r.docNo) ? <Link href={`/c/${cid}/member-loans/${r.entryId}`} title={r.kind === "loan" ? "Szerződés és módosítások" : "Visszafizetési bizonylat"}>{r.kind === "loan" ? r.contractNo : r.docNo}</Link> : <span className="muted small" title="A szerződés a lejárat megadása után készül el">{r.number}</span>}
                        {r.kind === "repayment" && r.allocations.length > 0 && <div className="small muted">→ {r.allocations.map((a) => a.contractNo).join(", ")}</div>}
                        {r.kind === "loan" && r.repaidBy.length > 0 && <div className="small muted">← {r.repaidBy.map((x) => x.docNo).join(", ")}</div>}
                      </td>
                      <td>{fmtDate(r.date)}</td>
                      <td>{r.kind === "loan" ? "Befizetés" : r.kind === "repayment" ? "Visszafizetés" : "Átértékelés"}</td>
                      <td className="num"><Amount r={r} /></td>
                      <td>{r.kind === "loan" ? fmtDate(r.originalDueDate) : ""}</td>
                      <td>
                        {r.kind === "loan" && (
                          <>
                            <strong>{fmtDate(r.dueDate) || <span className="muted">nincs megadva</span>}</strong>
                            {r.extensions.length > 0 && (
                              <div className="small muted">
                                {r.extensions.map((e) => (
                                  <div key={e.seq}><Link href={`/c/${cid}/member-loans/${r.entryId}?doc=M${e.seq}`}>{e.seq}. mód.</Link> +{e.days} nap ({fmtDate(e.fromDue)} → {fmtDate(e.toDue)})</div>
                                ))}
                              </div>
                            )}
                          </>
                        )}
                      </td>
                      <td className="num">{r.kind === "loan" ? <>{fmtHuf(r.open)}{r.currency && <div className="muted small">{fmtMoney(r.openFx, r.currency)}</div>}</> : ""}</td>
                      <td>{r.status && <span className={`badge ${statusClass[r.status]}`}>{r.status}</span>}</td>
                      {view === "all" && <td className="num">{fmtHuf(r.balance)}</td>}
                      {canWrite && (
                        <td className="no-print">
                          {r.kind === "loan" && r.status !== "Rendezve" && !r.dueDate && (
                            <form action={setLoanDueAction} className="row ml-extend" style={{ gap: 6, flexWrap: "nowrap", flexDirection: "row" }}>
                              <input type="hidden" name="cid" value={cid} />
                              <input type="hidden" name="entryId" value={r.entryId} />
                              <input type="date" name="dueDate" defaultValue={addDaysIso(r.date, 365)} required aria-label="Lejárat" />
                              <SubmitButton>Lejárat megadása</SubmitButton>
                            </form>
                          )}
                          {r.kind === "loan" && r.status !== "Rendezve" && r.dueDate && (
                            <div className="ml-extend">
                              <form action={extendLoanAction} className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                                <input type="hidden" name="cid" value={cid} />
                                <input type="hidden" name="entryId" value={r.entryId} />
                                <input type="number" name="days" min={1} max={3650} defaultValue={60} required aria-label="Hosszabbítás napokban" title="Hány nappal" />
                                <input type="date" name="extendedOn" defaultValue={t} aria-label="A módosítás kelte" title="A módosítás kelte" />
                                <SubmitButton>+ nap</SubmitButton>
                              </form>
                              {r.extensions.length > 0 && (
                                <form action={undoExtensionAction}>
                                  <input type="hidden" name="cid" value={cid} />
                                  <input type="hidden" name="entryId" value={r.entryId} />
                                  <button className="link small" title="Az utolsó hosszabbítás visszavonása">utolsó visszavonása</button>
                                </form>
                              )}
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                  {!rows.length && <tr><td colSpan={10} className="muted">Nincs ilyen tétel.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
      {data.members.length === 0 && <p className="muted">Még nincs tagi kölcsön. Az alábbi űrlappal rögzítheted az elsőt.</p>}

      {canWrite && (
        <details className="card no-print" style={{ marginTop: 18 }} open={data.members.length === 0}>
          <summary><strong>Új befizetés vagy visszafizetés</strong></summary>
          <form action={memberLoanAction} className="form-grid" style={{ marginTop: 10 }}>
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
            <label>Pénzeszköz
              <select name="moneyAccountId">
                {money.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}{a.currency !== "HUF" ? ` (${a.currency})` : ""}</option>)}
              </select>
            </label>
            <label>Összeg (Ft)<input name="amount" className="num" placeholder="devizásnál üresen: MNB-árfolyamon" /></label>
            <label>Devizaösszeg (devizás pénztár / számla)<input name="amountFx" className="num" placeholder="pl. 10000" /></label>
            <label>Lejárat (befizetésnél)<input type="date" name="dueDate" defaultValue={addDaysIso(t, 90)} /></label>
            <label>Törlesztett kölcsön (visszafizetésnél)
              <select name="targetLoanEntryId" defaultValue="">
                <option value="">automatikusan – a legkorábbi nyitott (FIFO)</option>
                {data.members.flatMap((mm) => mm.rows.filter((r) => r.kind === "loan" && r.status !== "Rendezve").map((r) => (
                  <option key={r.entryId} value={r.entryId}>{r.contractNo} – {mm.name} – nyitott {r.currency ? fmtMoney(r.openFx, r.currency) : `${fmtHuf(r.open)} Ft`}</option>
                )))}
              </select>
            </label>
            <label>Megjegyzés<input name="note" /></label>
            <div style={{ alignSelf: "end" }}><SubmitButton className="primary">Könyvelés</SubmitButton></div>
          </form>
          <p className="muted small" style={{ marginBottom: 0 }}>
            Befizetéskor a szerződés (TK), visszafizetéskor a visszafizetési bizonylat (TKV) automatikusan elkészül sorszámmal, és rögtön megnyílik nyomtatásra. Devizás pénztárba / számlára érkező kölcsön devizában marad nyilvántartva;
            devizás visszafizetésnél a kötelezettség a tag devizás átlagárán, a pénzeszköz a saját átlagárán csökken, a különbözet realizált árfolyam-különbözet (976 / 876).
          </p>
        </details>
      )}

      {canWrite && fxPools.length > 0 && (
        <details className="card no-print" style={{ marginTop: 12 }}>
          <summary><strong>Fordulónapi átértékelés (devizás kölcsön)</strong></summary>
          <p className="muted small">
            Szt. 60. §: a mérlegfordulónapon a devizás kötelezettség az MNB-árfolyamon szerepel. Nő a tartozás: T 877 / K 4791; csökken: T 4791 / K 977.
            Ha a számviteli politika szerint az összesített különbözet nem jelentős, el is hagyható. Tévedés esetén a naplóban sztornózható.
          </p>
          <form action={revalueMemberLoansAction} className="row" style={{ gap: 8 }}>
            <input type="hidden" name="cid" value={cid} />
            <label>Fordulónap<input type="date" name="date" defaultValue={yearEnd} required /></label>
            <SubmitButton className="primary">Átértékelés könyvelése</SubmitButton>
          </form>
        </details>
      )}

      <p className="muted small" style={{ marginTop: 12 }}>
        A forintos visszafizetések a legkorábbi nyitott forintos befizetést csökkentik (FIFO), a devizásak a devizás kölcsönöket. A tételek a 4791 Tagi kölcsön számlán könyvelődnek, a naplóban sztornózhatók.
        Hosszabbításkor a jelenlegi lejárathoz adódik a megadott napszám, és elkészül a sorszámozott szerződésmódosítás; az eredeti lejárat mindig megmarad.
      </p>
    </>
  );
}
