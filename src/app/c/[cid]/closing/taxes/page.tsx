import Link from "next/link";
import { requireCompany } from "@/lib/auth";
import { isPrivate } from "@/lib/entity";
import { Flash } from "@/components/Flash";
import { SubmitButton } from "@/components/SubmitButton";
import { fmtHuf } from "@/lib/money";
import { fmtDate, today } from "@/lib/dates";
import { companyTax, fyOf } from "@/lib/corp-tax-data";
import { citiesForZip, loadImportLog, POSTAL_SOURCE } from "@/lib/hipa-rules";
import { LOSS_USE_CAP, TAO_RATE, taxReturnDue } from "@/lib/corp-tax";
import { loadForecastInput } from "@/lib/forecast-data";
import { runForecast } from "@/lib/forecast";
import { refreshHakkaAction, saveHipaSitesAction, saveTaxAdjustmentsAction, uploadHakkaAction } from "./actions";

export const dynamic = "force-dynamic";

const ft = (n: number) => `${fmtHuf(n)} Ft`;
const pct = (x: number) => `${(Math.round(x * 10000) / 100).toString().replace(".", ",")}%`;
const shortHuf = (n: number | null) => (n == null ? "–" : `${fmtHuf(n)} Ft`);

/** Évzárás › TAO és HIPA: a teljes számítás üzleti évenként – tény, vagy tény + terv (Forecast). */
export default async function TaxesPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  const { company, role } = await requireCompany(cid);
  const canWrite = role !== "viewer";
  if (isPrivate(company)) return <p className="muted">Adószámos magánszemélynél nincs TAO; az SZJA és a HIPA a Adók oldalon.</p>;
  const curFy = fyOf(today(), company.fiscalYearStartMonth);
  const withPlan = sp.mode === "plan";

  // tény + terv: a folyó évhez a Forecast alap forgatókönyvének terv része
  let override: Parameters<typeof companyTax>[1] | undefined;
  let planNote: string | null = null;
  if (withPlan) {
    const input = await loadForecastInput(cid);
    const y = runForecast(input, "base").years.find((x) => x.year === curFy);
    if (y) {
      const planHipa = y.hipaBase + (input.opening.tax?.hipaDeduct ?? 0) - input.opening.ytdHipaBase;
      override = { fy: curFy, preTaxAdd: y.forecastPreTax, revenueAdd: planHipa, cogsAdd: 0, materialsAdd: 0 };
      planNote = `Terv (Forecast, alap forgatókönyv, ${y.partial ? "a horizont végéig" : "az üzleti év végéig"}): eredmény ${ft(y.forecastPreTax)}, HIPA-alap ${ft(planHipa)}.`;
    }
  }
  const [tax, log] = await Promise.all([companyTax(company, override), loadImportLog()]);
  const fy = tax.years.some((y) => y.fig.fy === sp.fy) ? sp.fy : curFy;
  const row = tax.years.find((y) => y.fig.fy === fy) ?? tax.years[tax.years.length - 1];
  const due = row ? taxReturnDue(row.fig.to) : null;
  const sitesShown = tax.sites.length ? tax.sites : [];
  const emptyRows = Math.max(1, 3 - sitesShown.length);
  const q = (o: Record<string, string>) => `?${new URLSearchParams({ ...(fy ? { fy } : {}), ...(withPlan ? { mode: "plan" } : {}), ...o })}`;

  return (
    <>
      <div className="topbar">
        <div>
          <h1>TAO és HIPA</h1>
          <span className="muted">{company.name} · társasági adó és helyi iparűzési adó üzleti évenként</span>
        </div>
        <div className="row">
          <Link className="btn" href={`/c/${cid}/closing`}>← Évzárás</Link>
          <Link className="btn" href={`/c/${cid}/forecast/settings`}>Forecast forgatókönyvek</Link>
        </div>
      </div>
      <Flash error={sp.error} ok={sp.ok} />

      <div className="row" style={{ marginBottom: 14 }}>
        <div className="segmented" role="tablist" aria-label="Üzleti év">
          {tax.years.map((y) => <Link key={y.fig.fy} className={y.fig.fy === fy ? "on" : undefined} href={q({ fy: y.fig.fy })}>{y.fig.fy}{y.estimate ? " (folyó)" : ""}</Link>)}
        </div>
        <div className="segmented" aria-label="Nézet">
          <Link className={!withPlan ? "on" : undefined} href={`?fy=${fy}`}>Tény</Link>
          <Link className={withPlan ? "on" : undefined} href={`?fy=${fy}&mode=plan`}>Tény + terv</Link>
        </div>
      </div>
      {withPlan && <p className="muted" style={{ marginTop: -6 }}>{planNote ?? "A Forecastban nincs terv a folyó üzleti évre."} A terv csak a folyó évet érinti.</p>}

      {row && (
        <>
          <div className="grid cols-4 lp-kpi">
            <div className="card stat"><div className="label">HIPA {row.fig.fy}{row.estimate ? " (becslés)" : ""}</div><div className="value">{fmtHuf(row.hipa.tax)}<small>Ft</small></div></div>
            <div className="card stat"><div className="label">TAO {row.fig.fy}{row.estimate ? " (becslés)" : ""}</div><div className="value">{fmtHuf(row.tao.tax)}<small>Ft</small></div></div>
            <div className="card stat primary"><div className="label">Összesen</div><div className="value">{fmtHuf(row.hipa.tax + row.tao.tax)}<small>Ft</small></div></div>
            <div className="card stat"><div className="label">Bevallás és befizetés</div><div className="value" style={{ fontSize: 20 }}>{due ? fmtDate(due) : "–"}</div></div>
          </div>

          <div className="grid cols-2" style={{ marginTop: 14, alignItems: "start" }}>
            <div className="card">
              <h2 style={{ marginTop: 0 }}>HIPA – helyi iparűzési adó</h2>
              <table className="statement">
                <tbody>
                  <tr><td>Nettó árbevétel (91–93)</td><td className="num">{ft(row.hipa.revenue)}</td></tr>
                  <tr><td className="indent-1">− Eladott áruk beszerzési értéke (811, 814) + közvetített szolgáltatások (815)</td><td className="num">−{ft(row.hipa.cogsDeducted)}</td></tr>
                  {row.hipa.cogsCap != null && <tr className="k-check"><td>500 m Ft feletti árbevétel: ELÁBÉ + közvetített szolgáltatás sávosan levonható (felső határ {ft(row.hipa.cogsCap)}; teljes {ft(row.hipa.cogsMediated)})</td><td /></tr>}
                  <tr><td className="indent-1">− Anyagköltség (51)</td><td className="num">−{ft(row.hipa.materials)}</td></tr>
                  <tr><td className="indent-1">− Alvállalkozói teljesítések (kézi)</td><td className="num">−{ft(row.hipa.subcontract)}</td></tr>
                  {row.hipa.rnd > 0 && <tr><td className="indent-1">− Kutatás-fejlesztés közvetlen költsége (kézi)</td><td className="num">−{ft(row.hipa.rnd)}</td></tr>}
                  <tr className="k-total"><td>Vállalkozási szintű adóalap</td><td className="num">{ft(row.hipa.base)}</td></tr>
                </tbody>
              </table>
              <table style={{ marginTop: 12 }}>
                <thead><tr><th>Település</th><th className="num">Arány</th><th className="num">Adóalap</th><th className="num">Mérték</th><th>Mentesség</th><th className="num">Adó</th></tr></thead>
                <tbody>
                  {row.hipa.lines.map((l, i) => (
                    <tr key={i}>
                      <td>{l.name}<div className="muted" style={{ fontSize: 12 }}>{l.role === "seat" ? "székhely" : "telephely"} · {l.ruleSource ?? "nincs adat → 2%, mentesség nélkül"}</div></td>
                      <td className="num">{pct(l.share)}</td><td className="num">{fmtHuf(l.base)}</td><td className="num">{pct(l.rate)}</td>
                      <td>{l.exempt ? <span className="badge posted" title={l.exemptReason ?? ""}>mentes</span> : <span className="muted">–</span>}</td>
                      <td className="num">{fmtHuf(l.tax)}</td>
                    </tr>
                  ))}
                  {!row.hipa.lines.length && <tr><td colSpan={6} className="muted">Nincs székhely megadva – add meg lent (vagy a cég címét a Beállításokban).</td></tr>}
                </tbody>
              </table>
              <p className="muted" style={{ fontSize: 12.5 }}>
                A HIPA alapja nem az eredmény, ezért veszteség mellett is lehet adó. Előleg: a következő két félévi részlet (márc. 15., szept. 15.) egyenként az éves adó fele;
                100 m Ft feletti árbevételnél december 20-ig feltöltés. Főkönyv: 867 (adók, illetékek – HIPA és egyéb) {row.fig.fy}. évi forgalma {ft(row.fig.taxes867)}.
              </p>
            </div>

            <div className="card">
              <h2 style={{ marginTop: 0 }}>TAO – társasági adó</h2>
              <table className="statement">
                <tbody>
                  <tr><td>Adózás előtti eredmény (főkönyv{withPlan && row.estimate ? " + terv" : ""})</td><td className="num">{ft(row.fig.preTax)}</td></tr>
                  {row.estimate && <tr><td className="indent-1">− Becsült HIPA (még nincs lekönyvelve)</td><td className="num">−{ft(row.hipa.tax)}</td></tr>}
                  <tr><td className="indent-1">+ Adóalapot növelő tételek (kézi)</td><td className="num">{ft(row.tao.increases)}</td></tr>
                  <tr><td className="indent-1">− Adóalapot csökkentő tételek (kézi)</td><td className="num">−{ft(row.tao.decreases)}</td></tr>
                  <tr className="k-subtotal"><td>Adóalap a veszteség leírása előtt</td><td className="num">{ft(row.tao.baseBeforeLoss)}</td></tr>
                  <tr><td className="indent-1">− Elhatárolt veszteség felhasználása (legfeljebb az adóalap {pct(LOSS_USE_CAP)}-a; rendelkezésre állt {ft(row.tao.lossAvailable)})</td><td className="num">−{ft(row.tao.lossUsed)}</td></tr>
                  <tr className="k-total"><td>Adóalap</td><td className="num">{ft(row.tao.base)}</td></tr>
                  <tr className="k-total"><td>Társasági adó ({pct(TAO_RATE)})</td><td className="num">{ft(row.tao.tax)}</td></tr>
                  {row.tao.newLoss > 0 && <tr className="k-check"><td>Az év elhatárolható vesztesége (a következő 5 adóévben használható fel)</td><td className="num">{ft(row.tao.newLoss)}</td></tr>}
                </tbody>
              </table>
              <p className="muted" style={{ fontSize: 12.5 }}>
                Továbbvihető veszteség az év végén: {row.tao.lossesAfter.length ? row.tao.lossesAfter.map((l) => `${l.year}: ${ft(l.amount)}`).join(" · ") : "nincs"}.
                Főkönyv: 891 (társasági adó) {row.fig.fy}. évi forgalma {ft(row.fig.taoBooked)}. Előleg: az éves adó alapján negyedévente (5 m Ft felett havonta), 100 m Ft feletti árbevételnél december 20-ig feltöltés.
              </p>
              {canWrite && (
                <form action={saveTaxAdjustmentsAction} className="form-grid" style={{ marginTop: 10 }}>
                  <input type="hidden" name="cid" value={cid} /><input type="hidden" name="fy" value={row.fig.fy} />
                  <label>TAO-alapot növelő tételek ({row.fig.fy})<input name="taoIncrease" className="num" defaultValue={row.adj.taoIncrease || ""} placeholder="0" /></label>
                  <label>TAO-alapot csökkentő tételek ({row.fig.fy})<input name="taoDecrease" className="num" defaultValue={row.adj.taoDecrease || ""} placeholder="0" /></label>
                  <label>HIPA: alvállalkozói teljesítések ({row.fig.fy})<input name="hipaSubcontract" className="num" defaultValue={row.adj.hipaSubcontract || ""} placeholder="0" /></label>
                  <label>HIPA: K+F közvetlen költség ({row.fig.fy})<input name="hipaRnd" className="num" defaultValue={row.adj.hipaRnd || ""} placeholder="0" /></label>
                  {[...tax.openingLosses, { year: "", amount: 0 }].map((l, i) => (
                    <label key={i} title="Az ERP-ben nem szereplő korábbi évek elhatárolt vesztesége">ERP előtti veszteség – év / összeg
                      <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                        <input name="lossYear" defaultValue={l.year} placeholder="év" style={{ width: 80 }} />
                        <input name="lossAmount" className="num" defaultValue={l.amount || ""} placeholder="0" />
                      </span>
                    </label>
                  ))}
                  <div style={{ alignSelf: "end" }}><SubmitButton className="primary" pendingText="Mentés…">Mentés</SubmitButton></div>
                </form>
              )}
            </div>
          </div>
        </>
      )}

      <h2>Évek áttekintése</h2>
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead><tr><th>Üzleti év</th><th className="num">HIPA-alap</th><th className="num">HIPA</th><th className="num">Adózás előtti eredmény</th><th className="num">Veszteség felhasználva</th><th className="num">TAO-alap</th><th className="num">TAO</th><th className="num">Továbbvihető veszteség</th></tr></thead>
          <tbody>
            {tax.years.map((y) => (
              <tr key={y.fig.fy}>
                <td><Link href={q({ fy: y.fig.fy })}>{y.fig.fy}</Link>{y.estimate ? <span className="muted"> (becslés)</span> : ""}</td>
                <td className="num">{fmtHuf(y.hipa.base)}</td><td className="num">{fmtHuf(y.hipa.tax)}</td>
                <td className={`num${y.preTaxForTao < 0 ? " neg" : ""}`}>{fmtHuf(y.preTaxForTao)}</td>
                <td className="num">{fmtHuf(y.tao.lossUsed)}</td><td className="num">{fmtHuf(y.tao.base)}</td><td className="num">{fmtHuf(y.tao.tax)}</td>
                <td className="num">{fmtHuf(y.tao.lossesAfter.reduce((a, l) => a + l.amount, 0))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Székhely és telephelyek</h2>
      <div className="card">
        {tax.sitesFromAddress && <p className="muted" style={{ marginTop: 0 }}>Nincs megadva telephely – a cég címéből számol {tax.sites[0] ? `(${tax.sites[0].zip} ${tax.sites[0].city}, székhely, 100%)` : "(a címben nincs irányítószám)"}.</p>}
        <form action={saveHipaSitesAction}>
          <input type="hidden" name="cid" value={cid} />
          <table>
            <thead><tr><th>Irányítószám</th><th>Település</th><th>Szerep</th><th className="num">Adóalap-megosztás %</th><th>HIPA-szabály</th></tr></thead>
            <tbody>
              {[...sitesShown, ...Array.from({ length: emptyRows }, () => null)].map((s, i) => {
                const opts = s ? citiesForZip(s.zip) : [];
                return (
                  <tr key={i}>
                    <td><input name="zip" defaultValue={s?.zip ?? ""} placeholder="pl. 1051" inputMode="numeric" style={{ width: 90 }} disabled={!canWrite} /></td>
                    <td>{opts.length > 1
                      ? <select name="city" defaultValue={s?.city} disabled={!canWrite}>{opts.map((c) => <option key={c}>{c}</option>)}</select>
                      : <><input type="hidden" name="city" value={s?.city ?? ""} />{s?.city ?? <span className="muted">az irányítószámból</span>}</>}</td>
                    <td><select name="role" defaultValue={s?.role ?? (i === 0 ? "seat" : "site")} disabled={!canWrite}><option value="seat">székhely</option><option value="site">telephely</option></select></td>
                    <td className="num"><input name="share" className="num" defaultValue={s ? Math.round(s.share * 1000) / 10 : ""} placeholder={i === 0 ? "100" : ""} style={{ width: 80 }} disabled={!canWrite} /></td>
                    <td>{s ? (s.rule
                      ? <>{pct(s.rule.rate)}{s.rule.exemptBelow != null ? ` · mentes, ha az adóalap ${s.rule.exemptInclusive ? "≤" : "<"} ${shortHuf(s.rule.exemptBelow)}` : " · nincs adóalap-mentesség"}<div className="muted" style={{ fontSize: 12 }}>{s.rule.source}</div>
                          {!!s.rule.notes?.length && <details><summary className="muted" style={{ fontSize: 12 }}>Kedvezmények, megjegyzések</summary><ul style={{ fontSize: 12, margin: "4px 0", paddingLeft: 16 }}>{s.rule.notes.map((n, k) => <li key={k}>{n}</li>)}</ul></details>}</>
                      : <span className="warn" style={{ color: "var(--warn)" }}>Nincs adat – 2%-kal, mentesség nélkül számol. Frissítsd a Kincstártól.</span>) : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="muted" style={{ fontSize: 12.5 }}>
            Több település esetén a vállalkozási szintű adóalapot a Htv. 3. melléklete szerint (személyi jellegű ráfordítás / eszközérték arányában) kell megosztani – az arányokat itt add meg, összesen 100%.
            A rendeleti mentesség a teljes (vállalkozási szintű) adóalaphoz kötött. Irányítószámok: {POSTAL_SOURCE}.
          </p>
          {canWrite && <SubmitButton className="primary" pendingText="Mentés…">Telephelyek mentése</SubmitButton>}
        </form>
      </div>

      <h2>HIPA-szabályok (Kincstár)</h2>
      <div className="card">
        <p style={{ marginTop: 0 }}>
          {tax.storeInfo
            ? <>Betöltve: <strong>{tax.storeInfo.count} önkormányzat</strong> · {tax.storeInfo.source} · {new Date(tax.storeInfo.fetchedAt).toLocaleString("hu-HU", { timeZone: "Europe/Budapest" })}</>
            : <>Még nincs letöltve – addig beépített szabály csak Mórra van (2%, mentes 2,5 m Ft adóalap alatt); a többi településen 2%, mentesség nélkül.</>}
        </p>
        {canWrite && (
          <div className="row" style={{ alignItems: "flex-end" }}>
            <form action={refreshHakkaAction}><input type="hidden" name="cid" value={cid} /><SubmitButton className="primary" pendingText="Letöltés a Kincstártól…">Frissítés a Kincstártól</SubmitButton></form>
            <form action={uploadHakkaAction} className="row" style={{ alignItems: "flex-end" }}>
              <input type="hidden" name="cid" value={cid} />
              <label>Vagy kézi feltöltés (a HAKKA oldal havi országos állománya)<input type="file" name="file" multiple accept=".zip,.xlsx,.xls,.csv,.xml,.txt" /></label>
              <SubmitButton pendingText="Feldolgozás…">Feltöltés</SubmitButton>
            </form>
          </div>
        )}
        <p className="muted" style={{ fontSize: 12.5 }}>
          Forrás: <a href="https://hakka.allamkincstar.gov.hu/" target="_blank" rel="noreferrer">Magyar Államkincstár – Tájékoztatás a bevezetett helyi adók szabályairól</a> (az önkormányzati jegyzők adatszolgáltatása; tájékoztató jellegű, a rendelet szövege az irányadó).
          Csak gombnyomásra frissül.
        </p>
        {log && (
          <details open={!log.ok}>
            <summary className={log.ok ? "muted" : undefined} style={log.ok ? undefined : { color: "var(--warn)", fontWeight: 600 }}>
              Utolsó frissítés: {new Date(log.at).toLocaleString("hu-HU", { timeZone: "Europe/Budapest" })} · {log.mode === "kincstar" ? "Kincstár" : "feltöltés"} · {log.ok ? "sikeres" : "sikertelen"} – {log.message}
            </summary>
            {!!log.diagnostics?.length && <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, maxHeight: 360, overflow: "auto", background: "var(--surface-2)", padding: 10, borderRadius: 8 }}>{log.diagnostics.join("\n")}</pre>}
          </details>
        )}
      </div>
    </>
  );
}
