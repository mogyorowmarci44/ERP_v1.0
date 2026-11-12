import Link from "next/link";
import { redirect } from "next/navigation";
import { requireCompany } from "@/lib/auth";
import { trialBalance, vatAnalytics } from "@/lib/reports";
import {
  DEFAULT_TAX_PROFILE,
  SZJA_METHOD_LABEL,
  compareSzjaMethods,
  flatRateSchedule,
  isPrivate,
  noInputVatDeduction,
  revenueAndCosts,
  vatExemptThreshold,
} from "@/lib/entity";
import { fmtHuf, round2 } from "@/lib/money";
import { fmtDate, today } from "@/lib/dates";

/** v2.0 – Adók: tételes átalányadó, SZJA-módszerek, alanyi ÁFA-mentesség, fordított ÁFA, IFA. */
export default async function TaxesPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  const { company } = await requireCompany(cid);
  if (!isPrivate(company)) redirect(`/c/${cid}`);
  const p = company.taxProfile ?? DEFAULT_TAX_PROFILE;
  const t = today();
  const year = /^\d{4}$/.test(sp.year ?? "") ? Number(sp.year) : Number(t.slice(0, 4));
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const asOf = year === Number(t.slice(0, 4)) ? t : to;

  const [tb, vat] = await Promise.all([trialBalance(cid, from, asOf), vatAnalytics(cid, from, to, { noInputVatDeduction: noInputVatDeduction(company) })]);
  const { revenue, costs } = revenueAndCosts(tb);

  // Időarányos éves becslés (csak a folyó évre)
  const dayOfYear = Math.max(1, Math.round((Date.parse(asOf) - Date.parse(from)) / 86_400_000) + 1);
  const yearDays = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
  const isCurrent = asOf !== to;
  const proj = (x: number) => (isCurrent ? round2((x * yearDays) / dayOfYear) : x);

  const methods = compareSzjaMethods({ revenue, costs, rooms: p.rooms, flatRatePerRoom: p.flatRatePerRoom });
  const methodsProj = compareSzjaMethods({ revenue: proj(revenue), costs: proj(costs), rooms: p.rooms, flatRatePerRoom: p.flatRatePerRoom });
  const best = methodsProj.reduce((a, m) => (m.total < a.total ? m : a), methodsProj[0]);
  const schedule = flatRateSchedule(p.rooms, p.flatRatePerRoom, year);

  // Alanyi ÁFA-mentesség: a belföldön teljesített értékesítések ellenértéke
  const threshold = vatExemptThreshold(year);
  const sales = round2(vat.rows.filter((r) => r.direction === "out").reduce((s, r) => s + Number(r.grossHuf), 0));
  const salesProj = proj(sales);
  const pct = Math.min(100, Math.round((sales / threshold) * 100));

  // Fordított ÁFA havonta (alanyi mentesnél is fizetendő, nem levonható)
  const rc = new Map<string, number>();
  for (const r of vat.rows) {
    if (r.direction === "in" && (r.vatKind === "reverse_charge" || r.vatKind === "eu_acquisition")) {
      const m = r.fulfillmentDate.slice(0, 7);
      rc.set(m, round2((rc.get(m) ?? 0) + Number(r.vatHuf)));
    }
  }
  const rcTotal = round2([...rc.values()].reduce((a, b) => a + b, 0));
  // Gyanús: ÁFA nélküli platform-jutalék, ami nincs fordított adózásként könyvelve.
  // (Ha az Airbnb maga számolt fel 27% ÁFA-t – nem adtál meg közösségi adószámot –, az rendben van: 27NL.)
  const suspicious = vat.rows.filter(
    (r) =>
      r.direction === "in" &&
      /airbnb|booking|expedia|szallas\.hu|vrbo/i.test(r.partnerName) &&
      !["reverse_charge", "eu_acquisition"].includes(r.vatKind) &&
      Number(r.vatHuf) === 0,
  );

  return (
    <>
      <div className="topbar">
        <h1>Adók – {year}</h1>
        <form className="row no-print">
          <select name="year" defaultValue={String(year)}>
            {[year - 1, year, year + 1].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <button>Váltás</button>
        </form>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <strong>{SZJA_METHOD_LABEL[p.szjaMethod]}</strong> · {p.vatExempt ? "alanyi ÁFA-mentes" : "ÁFA-körös (szállás 18%)"} · {p.rooms} szoba
        {p.beds ? `, ${p.beds} férőhely` : ""}{p.settlement ? ` · ${p.settlement}` : ""}{p.ntakId ? ` · ${p.ntakId}` : ""}
        {" "}· <Link href={`/c/${cid}/settings`}>profil szerkesztése</Link>
      </div>

      <div className="grid cols-4">
        <div className="card stat primary"><div className="label">Szállásbevétel ({fmtDate(asOf)}-ig)</div><div className="value">{fmtHuf(revenue)}<small>Ft</small></div></div>
        <div className="card stat"><div className="label">Igazolt költségek</div><div className="value">{fmtHuf(costs)}<small>Ft</small></div></div>
        <div className="card stat"><div className="label">Tételes adó (év)</div><div className="value">{fmtHuf(schedule.annual)}<small>Ft</small></div></div>
        <div className="card stat"><div className="label">Fordított ÁFA (év)</div><div className="value">{fmtHuf(rcTotal)}<small>Ft</small></div></div>
      </div>

      {p.szjaMethod === "flat_rate_room" && (
        <>
          <h2>Tételes átalányadó – részletek</h2>
          <table>
            <thead><tr><th>Negyedév</th><th>Esedékes</th><th className="num">Összeg</th><th>Állapot</th></tr></thead>
            <tbody>
              {schedule.installments.map((i) => (
                <tr key={i.quarter}>
                  <td>{year}. Q{i.quarter}</td><td>{fmtDate(i.due)}</td><td className="num">{fmtHuf(i.amount)}</td>
                  <td>{i.due < t ? <span className="muted">lejárt – fizetve?</span> : i.due.slice(0, 7) === t.slice(0, 7) ? <strong>ebben a hónapban esedékes</strong> : "későbbi"}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><th colSpan={2}>Éves összeg ({p.rooms} szoba × {fmtHuf(p.flatRatePerRoom)} Ft)</th><th className="num">{fmtHuf(schedule.annual)}</th><th /></tr></tfoot>
          </table>
          <p className="muted">Feltétel: ugyanannak a vendégnek évente legfeljebb 90 napra adható ki a szállás, és legfeljebb három ingatlanban végezhető. A tételes adó mellett is kötelező a számla / nyugta és a bevételi nyilvántartás.</p>
        </>
      )}

      <h2>SZJA – adózási módok összehasonlítása</h2>
      <table>
        <thead>
          <tr><th>Mód</th><th className="num">Jövedelem (eddig)</th><th className="num">SZJA</th><th className="num">Szocho (becslés)</th><th className="num">Összesen (eddig)</th><th className="num">Éves becslés</th><th>Megjegyzés</th></tr>
        </thead>
        <tbody>
          {methods.map((m, i) => (
            <tr key={m.method} style={m.method === p.szjaMethod ? { fontWeight: 600 } : undefined}>
              <td>{m.label}{m.method === p.szjaMethod ? " (jelenlegi)" : ""}{methodsProj[i].method === best.method ? " ★" : ""}</td>
              <td className="num">{fmtHuf(m.income)}</td><td className="num">{fmtHuf(m.szja)}</td><td className="num">{fmtHuf(m.szocho)}</td>
              <td className="num">{fmtHuf(m.total)}</td><td className="num">{fmtHuf(methodsProj[i].total)}</td><td className="muted">{m.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">
        ★ = az éves becslés alapján a legkisebb teher{isCurrent ? ` (időarányos vetítés: ${dayOfYear}/${yearDays} nap)` : ""}. SZJA 15%, szocho 13% a jövedelem 89%-a után – a szocho
        éves felső határát és az egyéb biztosítási jogviszonyt nem veszi figyelembe. A tételes adózás választása a következő évre az SZJA-bevallásban tehető meg; döntés előtt egyeztess könyvelővel.
      </p>

      <h2>ÁFA</h2>
      {p.vatExempt ? (
        <>
          <div className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span>Alanyi mentesség – értékesítések {year}-ben</span>
              <strong>{fmtHuf(sales)} / {fmtHuf(threshold)} Ft ({pct}%)</strong>
            </div>
            <div style={{ height: 8, background: "var(--line)", borderRadius: 4, marginTop: 8 }}>
              <div style={{ width: `${pct}%`, height: 8, borderRadius: 4, background: pct >= 90 ? "var(--neg, #c0392b)" : pct >= 75 ? "var(--warn)" : "var(--accent)" }} />
            </div>
            <p className="muted" style={{ marginBottom: 0 }}>
              Éves becslés: {fmtHuf(salesProj)} Ft.{" "}
              {salesProj > threshold ? <strong>A vetítés szerint az év végéig átlépheted az értékhatárt – az átlépést követően ÁFA-t kell felszámítani.</strong> : "A vetítés szerint az értékhatár alatt maradsz."}
            </p>
          </div>
          <h3>Fordított adózású ÁFA (pl. Airbnb jutalék)</h3>
          <p className="muted">
            Ha az Airbnb a közösségi adószámodra ÁFA nélkül számláz, a 27% ÁFA-t neked kell bevallani és befizetni (alanyi mentesként is), levonni nem lehet – FAD27 kóddal könyveld.
            Ha a számlán már szerepel 27% magyar ÁFA, azt az Airbnb fizeti be, neked nincs teendőd – 27NL kóddal könyveld.
          </p>
          <table>
            <thead><tr><th>Hónap</th><th className="num">Fizetendő ÁFA</th></tr></thead>
            <tbody>
              {[...rc.entries()].sort().map(([m, v]) => <tr key={m}><td>{m}</td><td className="num">{fmtHuf(v)}</td></tr>)}
              {rc.size === 0 && <tr><td colSpan={2} className="muted">Nincs fordított adózású beszerzés könyvelve.</td></tr>}
            </tbody>
          </table>
          {suspicious.length > 0 && (
            <div className="flash error" style={{ marginTop: 8 }}>
              {suspicious.length} platform-számla nem fordított adózású ÁFA-kóddal van könyvelve (pl. {suspicious[0].partnerName} – {suspicious[0].invoiceNumber}). ÁFA nélküli platform-számlánál FAD27 (fordított adózás) kell.
            </div>
          )}
        </>
      ) : (
        <p>ÁFA-körös vagy: a részletek az <Link href={`/c/${cid}/reports/vat`}>ÁFA analitikában</Link>.</p>
      )}

      <h2>Idegenforgalmi adó (IFA)</h2>
      <p className="muted">
        {p.ifaPerNight ? `Beállított tarifa: ${fmtHuf(p.ifaPerNight)} Ft / fő / vendégéjszaka.` : "Az IFA tarifája még nincs beállítva (Beállítások → Adózási profil)."} A beszedett IFA nem bevétel: a 4631-es
        számlára könyveld. A vendégéjszaka-alapú havi összesítő a foglalás-modullal érkezik.
      </p>
    </>
  );
}
