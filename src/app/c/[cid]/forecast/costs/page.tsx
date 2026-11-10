import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCompany } from "@/lib/auth";
import { costSuggestions } from "@/lib/forecast-data";
import { ForecastTabs } from "@/components/Forecast";
import { Flash } from "@/components/Flash";
import { fmtHuf } from "@/lib/money";
import { fmtDate, today } from "@/lib/dates";
import { saveItemAction, deleteItemAction, acceptSuggestionsAction, refreshSuggestedAction } from "../actions";

const CAT: Record<string, string> = {
  expense: "Költség", asset: "Tárgyi eszköz vásárlás", loan_in: "Tagi kölcsön be", loan_out: "Tagi kölcsön vissza",
  capital_in: "Tőkebefizetés", dividend: "Osztalék", other_in: "Egyéb bevétel (pénz)", other_out: "Egyéb kifizetés",
};
const FREQ: Record<string, string> = { monthly: "havonta", quarterly: "negyedévente", yearly: "évente", once: "egyszer" };

function ItemFields({ it }: { it?: typeof schema.forecastItems.$inferSelect }) {
  return (
    <>
      <label>Típus<select name="category" defaultValue={it?.category ?? "expense"}>{Object.entries(CAT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label>Megnevezés<input name="description" defaultValue={it?.description ?? ""} required /></label>
      <label>Nettó összeg (Ft)<input name="net" className="num" defaultValue={it ? Number(it.net) : ""} required /></label>
      <label>ÁFA<select name="vatRate" defaultValue={String(it?.vatRate ?? 27)}><option value="27">27%</option><option value="18">18%</option><option value="5">5%</option><option value="0">0% / mentes / ÁFA-n kívüli</option></select></label>
      <label>Levonható?<select name="deductible" defaultValue={it?.deductible === false ? "no" : "yes"}><option value="yes">igen</option><option value="no">nem</option></select></label>
      <label>Gyakoriság<select name="frequency" defaultValue={it?.frequency ?? "monthly"}>{Object.entries(FREQ).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label>Első / egyszeri dátum<input type="date" name="startDate" defaultValue={it?.startDate ?? today()} required /></label>
      <label>Vége (opcionális)<input type="date" name="endDate" defaultValue={it?.endDate ?? ""} /></label>
      <label>Fizetés<select name="payment" defaultValue={it?.payment ?? "bank"}><option value="bank">bank</option><option value="cash">készpénz</option></select></label>
      <label>Főkönyvi számla (opcionális)<input name="accountCode" defaultValue={it?.accountCode ?? ""} placeholder="pl. 529" /></label>
    </>
  );
}

export default async function ForecastCostsPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  const { role } = await requireCompany(cid);
  const canWrite = role !== "viewer";
  const [items, suggestions] = await Promise.all([
    db.select().from(schema.forecastItems).where(eq(schema.forecastItems.companyId, cid)).orderBy(asc(schema.forecastItems.category), asc(schema.forecastItems.startDate)),
    costSuggestions(cid),
  ]);
  const taken = (s: { accountCode: string; partnerName: string | null }) => items.some((i) => i.source === "suggested" && i.accountCode === s.accountCode && (i.partnerName ?? "") === (s.partnerName ?? ""));
  const fresh = suggestions.filter((s) => !taken(s));
  const monthly = items.filter((i) => i.category === "expense").reduce((a, i) => {
    const k = i.frequency === "monthly" ? 1 : i.frequency === "quarterly" ? 1 / 3 : i.frequency === "yearly" ? 1 / 12 : 0;
    return a + Number(i.net) * (1 + i.vatRate / 100) * k;
  }, 0);

  return (
    <div className="viz-sc">
      <h1>Forecast</h1>
      <ForecastTabs cid={cid} active="costs" />
      <Flash error={sp.error} ok={sp.ok} />

      <div className="grid cols-3" style={{ marginBottom: 14 }}>
        <div className="card stat primary"><div className="label">Ismétlődő költségek havonta (bruttó)</div><div className="value">{fmtHuf(monthly)}<small>Ft</small></div></div>
        <div className="card stat"><div className="label">Tervtételek</div><div className="value">{items.length}<small>db</small></div></div>
        <div className="card stat"><div className="label">Új javaslat a könyvelésből</div><div className="value">{fresh.length}<small>db</small></div></div>
      </div>

      <h2>Javaslatok az elmúlt 3 lezárt hónap költségeiből</h2>
      <p className="muted" style={{ marginTop: -4 }}>
        Azok a költségek, amelyek legalább 2 hónapban előfordultak (szállítónként és főkönyvi számlánként), a legutóbbi havi összeggel. Az autóra könyvelt (készletre aktivált) tételek nincsenek benne.
      </p>
      {fresh.length > 0 ? (
        <form action={acceptSuggestionsAction}>
          <input type="hidden" name="cid" value={cid} />
          <div className="table-wrap">
            <table>
              <thead><tr><th /><th>Szállító / tétel</th><th>Számla</th><th className="num">Hónap</th><th className="num">Havi nettó</th><th className="num">ÁFA</th><th>Fizetés</th></tr></thead>
              <tbody>
                {fresh.map((s) => (
                  <tr key={s.key}>
                    <td><input type="checkbox" name="key" value={s.key} defaultChecked aria-label={`${s.partnerName ?? s.accountName} felvétele`} /></td>
                    <td>{s.partnerName ?? <span className="muted">(partner nélkül)</span>}</td>
                    <td>{s.accountCode} {s.accountName}</td>
                    <td className="num">{s.months}/3</td>
                    <td className="num">{fmtHuf(s.monthlyNet)}</td>
                    <td className="num">{s.vatRate}%</td>
                    <td>{s.payment === "cash" ? "készpénz" : "bank"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {canWrite && <div className="row" style={{ marginTop: 8 }}><button className="primary">Kijelöltek felvétele havi tételként</button></div>}
        </form>
      ) : (
        <p className="muted">Nincs új javaslat.</p>
      )}

      <div className="fc-head" style={{ marginTop: 18 }}>
        <h2 style={{ margin: 0 }}>Tervtételek</h2>
        {canWrite && items.some((i) => i.source === "suggested") && (
          <form action={refreshSuggestedAction}><input type="hidden" name="cid" value={cid} /><button>Javasolt tételek frissítése a legutóbbi adatokkal</button></form>
        )}
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Típus</th><th>Megnevezés</th><th className="num">Nettó</th><th className="num">ÁFA</th><th>Gyakoriság</th><th>Időszak</th><th>Fizetés</th><th /></tr></thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id}>
                <td>{CAT[i.category] ?? i.category}{i.source === "suggested" && <span className="badge reserved" style={{ marginLeft: 6 }}>javaslat</span>}</td>
                <td>
                  {i.description}{i.accountCode ? <span className="muted"> · {i.accountCode}</span> : null}
                  {canWrite && (
                    <details className="fc-more">
                      <summary>szerkesztés</summary>
                      <form action={saveItemAction} className="form-grid" style={{ marginTop: 8 }}>
                        <input type="hidden" name="cid" value={cid} /><input type="hidden" name="id" value={i.id} />
                        <ItemFields it={i} />
                        <div style={{ alignSelf: "end" }}><button>Mentés</button></div>
                      </form>
                    </details>
                  )}
                </td>
                <td className="num">{fmtHuf(Number(i.net))}</td>
                <td className="num">{i.vatRate}%{i.deductible ? "" : " (nem levonható)"}</td>
                <td>{FREQ[i.frequency] ?? i.frequency}</td>
                <td>{fmtDate(i.startDate)}{i.endDate ? ` – ${fmtDate(i.endDate)}` : i.frequency !== "once" ? " –" : ""}</td>
                <td>{i.payment === "cash" ? "készpénz" : "bank"}</td>
                <td>
                  {canWrite && (
                    <form action={deleteItemAction}><input type="hidden" name="cid" value={cid} /><input type="hidden" name="id" value={i.id} /><button className="link">törlés</button></form>
                  )}
                </td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={8} className="muted">Még nincs tervtétel. Vedd fel a javaslatokat, vagy adj hozzá kézzel.</td></tr>}
          </tbody>
        </table>
      </div>

      {canWrite && (
        <>
          <h2>Új tétel</h2>
          <form action={saveItemAction} className="card form-grid">
            <input type="hidden" name="cid" value={cid} />
            <ItemFields />
            <div style={{ alignSelf: "end" }}><button className="primary">Hozzáadás</button></div>
          </form>
          <p className="muted">
            Költség: eredményt csökkent, a levonható ÁFA csökkenti a befizetést. Tárgyi eszköz: csak pénzáramlás és ÁFA (az értékcsökkenés nincs benne).
            Tagi kölcsön, tőke, osztalék: csak pénzáramlás. Az autóhoz kötött költségeket (javítás, fényezés, honosítás) a Készlet fülön, az adott autónál add meg.
          </p>
        </>
      )}
    </div>
  );
}
