import { desc, gte } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCompany } from "@/lib/auth";
import { refreshRatesAction, manualRateAction } from "../actions";
import { Flash } from "@/components/Flash";
import { addDays } from "@/lib/fx";
import { fmtDate, today } from "@/lib/dates";

export default async function FxPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  await requireCompany(cid);
  const t = today();
  const rows = await db.select().from(schema.fxRates).where(gte(schema.fxRates.date, addDays(t, -60))).orderBy(desc(schema.fxRates.date), schema.fxRates.currency);
  return (
    <>
      <h1>Árfolyamok (MNB)</h1>
      <Flash error={sp.error} ok={sp.ok} />
      <div className="card">
        <p style={{ marginTop: 0 }}>
          <strong>Árfolyam-politika:</strong> a cég az ÁFA alap átszámításához az MNB hivatalos devizaárfolyamát választotta (NAV bejelentés).
          A devizás számlák követelése / kötelezettsége ugyanezen az árfolyamon kerül a könyvekbe (Szt. 60. § (5a)), az Áfa tv. 80. § szerinti napon:
          teljesítés napja; időszakos elszámolásnál a számla kelte; Közösségen belüli beszerzésnél a számla kelte, legkésőbb a teljesítést követő hó 15-e.
        </p>
        <p className="muted" style={{ marginBottom: 0 }}>
          Kiegyenlítéskor: forintszámláról a ténylegesen terhelt forint; devizaszámlára befolyó összeg MNB árfolyamon; devizaszámláról kifizetett összeg
          a deviza könyv szerinti értékén (átlagár). A különbség realizált árfolyam-különbözet (976 / 876). Ezt a számviteli politikában is rögzíteni kell.
        </p>
      </div>
      <h2>Letöltés az MNB-től</h2>
      <form action={refreshRatesAction} className="card form-grid">
        <input type="hidden" name="cid" value={cid} />
        <label>Dátum-tól<input type="date" name="from" defaultValue={addDays(t, -31)} /></label>
        <label>-ig<input type="date" name="to" defaultValue={t} /></label>
        <label>Devizák<input name="currencies" defaultValue="EUR,USD,CHF,GBP" /></label>
        <div style={{ alignSelf: "end" }}><button className="primary">Letöltés</button></div>
      </form>
      <h2>Kézi rögzítés</h2>
      <p className="muted">Csak ha az MNB szolgáltatás nem érhető el – a hivatalos MNB árfolyamot írd be (mnb.hu).</p>
      <form action={manualRateAction} className="card form-grid">
        <input type="hidden" name="cid" value={cid} />
        <label>Dátum<input type="date" name="date" defaultValue={t} required /></label>
        <label>Deviza<input name="currency" defaultValue="EUR" maxLength={3} required /></label>
        <label>Árfolyam (Ft / 1 egység)<input name="rate" className="num" required /></label>
        <div style={{ alignSelf: "end" }}><button>Rögzítés</button></div>
      </form>
      <h2>Tárolt árfolyamok (utolsó 60 nap)</h2>
      <table>
        <thead><tr><th>Dátum</th><th>Deviza</th><th className="num">Árfolyam</th><th>Forrás</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.currency}${r.date}`}><td>{fmtDate(r.date)}</td><td>{r.currency}</td><td className="num">{String(r.rate).replace(".", ",")}</td><td>{r.source === "manual" ? "kézi" : "MNB"}</td></tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={4} className="muted">Még nincs tárolt árfolyam – a számlarögzítés automatikusan letölti.</td></tr>}
        </tbody>
      </table>
    </>
  );
}
