import Link from "next/link";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCompany } from "@/lib/auth";
import { defaultAccounts, itemsWithBalance, monthlyCogs } from "@/lib/inventory";
import { saveItemAction, postCogsAction } from "./actions";
import { Flash } from "@/components/Flash";
import { fmtHuf, fmtNum } from "@/lib/money";
import { today } from "@/lib/dates";

export const dynamic = "force-dynamic";

/** v6.3.0 – Készletnyilvántartás: cikkek egyenleggel, új cikk, havi ELÁBÉ, egyeztetés a főkönyvvel. */
export default async function InventoryPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  const { role } = await requireCompany(cid);
  const t = today();
  const year = Number(sp.year) || Number(t.slice(0, 4));
  const [list, months, def] = await Promise.all([itemsWithBalance(cid), monthlyCogs(cid, year), defaultAccounts(cid)]);
  const active = list.filter((i) => i.isActive || i.qty !== 0);
  const total = active.reduce((s, i) => s + i.value, 0);
  const low = active.filter((i) => i.low);
  // egyeztetés: a nyilvántartás szerinti érték vs. a készletszámlák főkönyvi egyenlege (ma)
  const codes = [...new Set(list.map((i) => i.stockAccount))];
  const gl = codes.length
    ? ((await db
        .select({ code: schema.accounts.code, bal: sql<number>`coalesce(sum(${schema.journalLines.debit} - ${schema.journalLines.credit}), 0)::float8` })
        .from(schema.journalLines)
        .innerJoin(schema.accounts, eq(schema.accounts.id, schema.journalLines.accountId))
        .innerJoin(schema.journalEntries, eq(schema.journalEntries.id, schema.journalLines.entryId))
        .where(and(eq(schema.journalLines.companyId, cid), inArray(schema.accounts.code, codes), sql`${schema.journalEntries.date} <= ${t}`))
        .groupBy(schema.accounts.code)) as { code: string; bal: number }[])
    : [];
  const glMap = new Map(gl.map((g) => [g.code, Number(g.bal)]));
  const ym = t.slice(0, 7);
  return (
    <>
      <h1>Készlet</h1>
      <Flash error={sp.error} ok={sp.ok} />
      <p className="muted" style={{ marginTop: -4 }}>
        Cikkenkénti nyilvántartás csúsztatott átlagáron. A szállítói számla cikkes sora bevételez, a vevőszámla cikkes sora kiad (a számla
        „Cikk” oszlopában). Az eladott áruk beszerzési értékét (ELÁBÉ) havonta, egy gombnyomással könyveled; leltári eltérést a cikk lapján rögzíthetsz.
      </p>
      <div className="grid cols-3" style={{ marginBottom: 14 }}>
        <div className="card stat"><div className="label">Cikkek</div><div className="value">{active.length}</div></div>
        <div className="card stat"><div className="label">Készletérték</div><div className="value">{fmtHuf(total)} Ft</div></div>
        <div className="card stat"><div className="label">Minimum alatt</div><div className="value">{low.length}</div></div>
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr><th>Cikk</th><th>Cikkszám</th><th className="num">Készlet</th><th className="num">Átlagár</th><th className="num">Érték</th><th>Számlák</th></tr></thead>
          <tbody>
            {active.map((i) => (
              <tr key={i.id}>
                <td><Link href={`/c/${cid}/inventory/${i.id}`}><strong>{i.name}</strong></Link>{!i.isActive && <span className="badge draft" style={{ marginLeft: 6 }}>inaktív</span>}{i.low && <span className="badge overdue" style={{ marginLeft: 6 }}>minimum alatt</span>}</td>
                <td>{i.sku ?? ""}</td>
                <td className="num">{fmtNum(i.qty, { maximumFractionDigits: 4 })} {i.unit}</td>
                <td className="num">{fmtHuf(i.avg)}</td>
                <td className="num">{fmtHuf(i.value)}</td>
                <td className="muted" style={{ fontSize: 12 }}>{i.stockAccount} → {i.cogsAccount}</td>
              </tr>
            ))}
            {active.length === 0 && <tr><td colSpan={6} className="muted">Még nincs cikk – vegyél fel egyet lent.</td></tr>}
          </tbody>
        </table>
      </div>

      <h2>Új cikk</h2>
      <form action={saveItemAction} className="card form-grid">
        <input type="hidden" name="cid" value={cid} />
        <label>Megnevezés<input name="name" required /></label>
        <label>Cikkszám<input name="sku" /></label>
        <label>Mennyiségi egység<input name="unit" defaultValue="db" /></label>
        <label>Minimum készlet<input name="minQty" inputMode="decimal" /></label>
        <label title="A készlet főkönyvi számlája">Készletszámla<input name="stockAccount" defaultValue={def.stock} required /></label>
        <label title="Eladott áruk beszerzési értéke">ELÁBÉ-számla<input name="cogsAccount" defaultValue={def.cogs} required /></label>
        <div style={{ alignSelf: "end" }}><button className="primary" disabled={role === "viewer"}>Felvétel</button></div>
      </form>

      <h2>Egyeztetés a főkönyvvel (mai nap)</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Készletszámla</th><th className="num">Nyilvántartás szerint</th><th className="num">Főkönyv szerint</th><th className="num">Eltérés</th></tr></thead>
          <tbody>
            {codes.map((c) => {
              const inv = active.filter((i) => i.stockAccount === c).reduce((s, i) => s + i.value, 0);
              const g = glMap.get(c) ?? 0;
              const d = Math.round((g - inv) * 100) / 100;
              return (
                <tr key={c}>
                  <td>{c}</td><td className="num">{fmtHuf(inv)}</td><td className="num">{fmtHuf(g)}</td>
                  <td className="num">{Math.abs(d) < 1 ? <span className="badge posted">egyezik</span> : <span title="Tipikus ok: le nem könyvelt havi ELÁBÉ, nyitó készlet főkönyvi rögzítése hiányzik, vagy a számlatételen más ellenszámla szerepel." className="badge overdue">{fmtHuf(d)}</span>}</td>
                </tr>
              );
            })}
            {codes.length === 0 && <tr><td colSpan={4} className="muted">–</td></tr>}
          </tbody>
        </table>
      </div>

      <h2>Eladott áruk beszerzési értéke (ELÁBÉ) – {year}</h2>
      <div className="row" style={{ gap: 8, marginBottom: 8 }}>
        <Link href={`?year=${year - 1}`}>← {year - 1}</Link>
        <Link href={`?year=${year + 1}`}>{year + 1} →</Link>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Hónap</th><th className="num">Számított</th><th className="num">Lekönyvelve</th><th className="num">Különbözet</th><th /></tr></thead>
          <tbody>
            {months.filter((m) => m.computed || m.booked).map((m) => (
              <tr key={m.period}>
                <td>{m.period}</td>
                <td className="num">{fmtHuf(m.computed)}</td>
                <td className="num">{fmtHuf(m.booked)}</td>
                <td className="num">{Math.abs(m.diff) < 0.5 ? <span className="badge posted">rendben</span> : fmtHuf(m.diff)}</td>
                <td>
                  {Math.abs(m.diff) >= 0.5 && role !== "viewer" && (
                    <form action={postCogsAction}>
                      <input type="hidden" name="cid" value={cid} />
                      <input type="hidden" name="period" value={m.period} />
                      <button className={m.period < ym ? "primary" : ""} title={m.period >= ym ? "A hónap még nem zárult le – később újra lehet könyvelni a különbözetet." : ""}>Könyvelés ({m.to})</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {months.every((m) => !m.computed && !m.booked) && <tr><td colSpan={5} className="muted">Ebben az évben még nem volt cikkes kiadás.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>
        Mindig csak a különbözet könyvelődik (T ELÁBÉ / K készlet, a hónap utolsó napjára), így ha később sztornózol vagy visszadátumozva
        rögzítesz számlát, a hónap újra könyvelhető. Zárt időszakra nem könyvel.
      </p>
    </>
  );
}
