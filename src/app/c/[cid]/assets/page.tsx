import Link from "next/link";
import { redirect } from "next/navigation";
import { requireCompany } from "@/lib/auth";
import { isPrivate } from "@/lib/entity";
import { Flash } from "@/components/Flash";
import { ConfirmButton } from "@/components/ConfirmButton";
import { fmtHuf } from "@/lib/money";
import { fmtDate, today } from "@/lib/dates";
import { LOW_VALUE_LIMIT, assetCandidates, assetMirror, depreciationDue, listAssets, periodOf, reconcile, ASSET_ACCOUNTS } from "@/lib/assets";
import { registerLineAction, postDepreciationAction } from "./actions";
import { Plus, CircleCheck, TriangleAlert } from "lucide-react";

export const dynamic = "force-dynamic";

const life = (m: number) => (m % 12 === 0 ? `${m / 12} év` : `${m} hó`);

/** Tárgyi eszközök nyilvántartása + havi ÉCS elszámolás + főkönyvi egyeztetés + eszköztükör. */
export default async function AssetsPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  const { company, role } = await requireCompany(cid);
  if (isPrivate(company)) redirect(`/c/${cid}`);
  const canWrite = role !== "viewer";
  const curP = periodOf(today());
  const to = /^\d{4}-\d{2}$/.test(sp.to ?? "") && sp.to <= curP ? sp.to : curP;
  const year = Number(sp.year) || Number(curP.slice(0, 4));
  const [assets, candidates, due, rec, mirror] = await Promise.all([listAssets(cid), assetCandidates(cid), depreciationDue(cid, to), reconcile(cid), assetMirror(cid, year)]);
  const active = assets.filter((a) => a.status === "active");
  const dueTotal = due.reduce((s, p) => s + p.total, 0);
  const label = (code: string) => ASSET_ACCOUNTS.find((x) => x.code === code)?.label ?? code;

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Tárgyi eszközök</h1>
          <span className="muted">{company.name} · {active.length} aktív eszköz · bruttó {fmtHuf(active.reduce((s, a) => s + Number(a.cost), 0))} Ft · nettó {fmtHuf(active.reduce((s, a) => s + a.net, 0))} Ft</span>
        </div>
        {canWrite && <Link className="btn primary" href={`/c/${cid}/assets/new`}><Plus size={16} /> Új eszköz kézzel</Link>}
      </div>
      <Flash error={sp.error} ok={sp.ok} />

      {candidates.length > 0 && (
        <div className="card" style={{ marginBottom: 14, borderColor: "var(--accent-line)" }}>
          <h3 style={{ marginTop: 0 }}>Nyilvántartásba vételre vár ({candidates.length})</h3>
          <p className="muted small" style={{ marginTop: 0 }}>Könyvelt szállítói számlasorok eszközszámlán (11x–14x), amelyekhez még nincs eszközkarton. {fmtHuf(LOW_VALUE_LIMIT)} Ft-ig kisértékű: nyilvántartásba vételkor egy összegben leíródik.</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Dátum</th><th>Számla</th><th>Megnevezés</th><th>Számla</th><th className="num">Nettó (Ft)</th><th>Kezelés</th>{canWrite && <th />}</tr></thead>
              <tbody>
                {candidates.map((c) => (
                  <tr key={c.id}>
                    <td>{fmtDate(c.date)}</td>
                    <td><Link href={`/c/${cid}/invoices/${c.invoice_id}`}>{c.invoice_number}</Link><div className="small muted">{c.partner}</div></td>
                    <td>{c.description}</td>
                    <td className="mono">{c.account}</td>
                    <td className="num">{fmtHuf(c.net)}</td>
                    <td>{c.written_off ? <span className="badge posted">már leírva a főkönyvben</span> : c.lowValue ? <span className="badge draft">kisértékű – azonnali leírás</span> : <span className="badge">havi lineáris ÉCS</span>}</td>
                    {canWrite && (
                      <td>
                        <form action={registerLineAction}>
                          <input type="hidden" name="cid" value={cid} /><input type="hidden" name="lineId" value={c.id} />
                          <button className="primary small">Nyilvántartásba</button>
                        </form>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="fc-head">
          <h3 style={{ margin: 0 }}>Havi ÉCS elszámolása</h3>
          <form className="row" style={{ gap: 8 }}>
            <label>Hónapig (bezárólag)<input type="month" name="to" defaultValue={to} max={curP} /></label>
            <button style={{ alignSelf: "end" }}>Előnézet</button>
          </form>
        </div>
        {due.length === 0 ? (
          <p className="muted" style={{ marginBottom: 0 }}><CircleCheck size={14} /> {to}-ig (bezárólag) minden ÉCS el van számolva.</p>
        ) : (
          <>
            <div className="table-wrap" style={{ marginTop: 10 }}>
              <table>
                <thead><tr><th>Hónap</th><th>Könyvelés dátuma</th><th>Eszközök</th><th className="num">ÉCS (Ft)</th><th className="num">Adótörvényi (Ft)</th><th /></tr></thead>
                <tbody>
                  {due.map((p) => (
                    <tr key={p.period}>
                      <td>{p.period}</td>
                      <td>{fmtDate(p.date)}</td>
                      <td className="small">{p.lines.map((l) => `${l.name}: ${fmtHuf(l.amount)}`).join(" · ")}</td>
                      <td className="num">{fmtHuf(p.total)}</td>
                      <td className="num">{fmtHuf(p.lines.reduce((s, l) => s + l.taxAmount, 0))}</td>
                      <td>{p.locked && <span className="badge overdue">lezárt hónap – kimarad</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {canWrite && (
              <form action={postDepreciationAction} className="row" style={{ marginTop: 10 }}>
                <input type="hidden" name="cid" value={cid} /><input type="hidden" name="to" value={to} />
                <ConfirmButton className="primary" message={`Könyveljem a ${to}-ig esedékes ${fmtHuf(dueTotal)} Ft értékcsökkenést (havonta egy VN tétel, T 571 / K 1x9)?`} pendingText="Könyvelés…">
                  ÉCS könyvelése ({fmtHuf(dueTotal)} Ft)
                </ConfirmButton>
                <span className="muted small">Hónaponként egy vegyes tétel a hónap utolsó napjával (folyó hónapban a mai nappal).</span>
              </form>
            )}
          </>
        )}
      </div>

      <h2>Eszközkartonok</h2>
      {assets.length === 0 ? <p className="muted">Még nincs nyilvántartott eszköz.</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Leltári szám</th><th>Megnevezés</th><th>Számla</th><th>Aktiválás</th><th>Élettartam</th><th className="num">Bekerülés</th><th className="num">Halmozott ÉCS</th><th className="num">Nettó</th><th>Állapot</th></tr></thead>
            <tbody>
              {assets.map((a) => (
                <tr key={a.id}>
                  <td className="mono"><Link href={`/c/${cid}/assets/${a.id}`}>{a.inventoryNo ?? `#${a.id}`}</Link></td>
                  <td><Link href={`/c/${cid}/assets/${a.id}`}>{a.name}</Link>{a.serialNo && <div className="small muted">S/N {a.serialNo}</div>}</td>
                  <td className="mono" title={label(a.accountCode)}>{a.accountCode}</td>
                  <td>{fmtDate(a.activationDate)}</td>
                  <td>{a.method === "lowvalue" ? "egy összegben" : life(a.usefulLifeMonths)}</td>
                  <td className="num">{fmtHuf(Number(a.cost))}</td>
                  <td className="num">{fmtHuf(a.accumulated)}</td>
                  <td className="num">{fmtHuf(a.net)}</td>
                  <td>{a.status === "disposed" ? <span className="badge">kivezetve {fmtDate(a.disposedOn)}</span> : a.net <= 0 ? <span className="badge posted">0-ra leírva</span> : <span className="badge draft">használatban</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 style={{ marginTop: 20 }}>Egyeztetés a főkönyvvel</h2>
      {rec.length === 0 ? <p className="muted">Nincs eszközszámla-egyenleg.</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Főkönyvi számla</th><th>Tartalom</th><th className="num">Nyilvántartás</th><th className="num">Főkönyv</th><th className="num">Eltérés</th><th /></tr></thead>
            <tbody>
              {rec.map((r) => (
                <tr key={r.code}>
                  <td>{r.kind === "gross" ? label(r.code) : <span className="mono">{r.code}</span>}</td>
                  <td>{r.kind === "gross" ? "bruttó érték" : "halmozott ÉCS"}</td>
                  <td className="num">{fmtHuf(r.reg)}</td><td className="num">{fmtHuf(r.gl)}</td>
                  <td className={`num${r.ok ? "" : " neg"}`}>{fmtHuf(r.gl - r.reg)}</td>
                  <td>{r.ok ? <span className="badge posted"><CircleCheck size={12} /> egyezik</span> : <span className="badge overdue"><TriangleAlert size={12} /> eltérés</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="fc-head" style={{ marginTop: 20 }}>
        <h2 style={{ margin: 0 }}>Eszköztükör – {year}</h2>
        <form className="row" style={{ gap: 8 }}>
          <label>Év<input type="number" name="year" defaultValue={year} min={2000} max={2100} style={{ width: 90 }} /></label>
          <button style={{ alignSelf: "end" }}>Mutasd</button>
        </form>
      </div>
      {mirror.rows.length === 0 ? <p className="muted">Ebben az évben nincs nyilvántartott eszköz.</p> : (
        <>
          <div className="table-wrap" style={{ marginTop: 8 }}>
            <table>
              <thead>
                <tr><th rowSpan={2}>Eszközcsoport</th><th colSpan={4} style={{ textAlign: "center" }}>Bruttó érték</th><th colSpan={4} style={{ textAlign: "center" }}>Értékcsökkenés</th><th className="num" rowSpan={2}>Nettó (záró)</th></tr>
                <tr><th className="num">Nyitó</th><th className="num">Növ.</th><th className="num">Csökk.</th><th className="num">Záró</th><th className="num">Nyitó</th><th className="num">Növ.</th><th className="num">Csökk.</th><th className="num">Záró</th></tr>
              </thead>
              <tbody>
                {mirror.rows.map((r) => (
                  <tr key={r.code}>
                    <td>{r.label}</td>
                    <td className="num">{fmtHuf(r.openGross)}</td><td className="num">{fmtHuf(r.addGross)}</td><td className="num">{fmtHuf(r.outGross)}</td><td className="num">{fmtHuf(r.closeGross)}</td>
                    <td className="num">{fmtHuf(r.openAcc)}</td><td className="num">{fmtHuf(r.addAcc)}</td><td className="num">{fmtHuf(r.outAcc)}</td><td className="num">{fmtHuf(r.closeAcc)}</td>
                    <td className="num"><strong>{fmtHuf(r.closeGross - r.closeAcc)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">
            {year}. évi ÉCS: számviteli {fmtHuf(mirror.yearAcc)} Ft · adótörvény szerinti {fmtHuf(mirror.yearTax)} Ft
            {mirror.taoCorrection !== 0 ? ` · TAO-alap korrekció: +${fmtHuf(mirror.yearAcc)} / −${fmtHuf(mirror.yearTax)} Ft (nettó ${mirror.taoCorrection > 0 ? "növelő" : "csökkentő"} ${fmtHuf(Math.abs(mirror.taoCorrection))} Ft)` : " · nincs TAO-korrekció"}.
            Az eszköztükör az éves beszámoló kiegészítő mellékletébe automatikusan bekerül.
          </p>
        </>
      )}
    </>
  );
}
