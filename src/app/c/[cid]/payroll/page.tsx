import Link from "next/link";
import { redirect } from "next/navigation";
import { requireCompany } from "@/lib/auth";
import { isPrivate } from "@/lib/entity";
import { Flash } from "@/components/Flash";
import { ConfirmButton } from "@/components/ConfirmButton";
import { PayrollGrid } from "@/components/PayrollGrid";
import { fmtHuf } from "@/lib/money";
import { today } from "@/lib/dates";
import { loadMonth, openMonths, periodEnd } from "@/lib/payroll";
import { postPayrollAction, unpostPayrollAction, markExternalAction } from "./actions";
import { Users, SlidersHorizontal, ChevronLeft, ChevronRight, CircleCheck, TriangleAlert } from "lucide-react";

export const dynamic = "force-dynamic";

const shift = (p: string, d: number) => { const [y, m] = p.split("-").map(Number); const t = new Date(Date.UTC(y, m - 1 + d, 1)); return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`; };
const MONTH = ["január", "február", "március", "április", "május", "június", "július", "augusztus", "szeptember", "október", "november", "december"];
const label = (p: string) => `${p.slice(0, 4)}. ${MONTH[Number(p.slice(5)) - 1]}`;

/** Bérszámfejtés – havi bértábla. */
export default async function PayrollPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  const { company, role } = await requireCompany(cid);
  if (isPrivate(company)) redirect(`/c/${cid}`);
  const canWrite = role !== "viewer";
  const cur = today().slice(0, 7);
  const period = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.period ?? "") ? sp.period : cur;
  const [m, open] = await Promise.all([loadMonth(cid, period), openMonths(cid, Number(period.slice(0, 4)))]);
  const posted = m.run?.status === "posted";
  const external = m.run?.status === "external";
  const t = m.totals;

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Bérszámfejtés – {label(period)}</h1>
          <span className="muted">{company.name} · {m.rows.length} jogviszony · minimálbér {fmtHuf(m.params.minWage)} Ft · garantált bérminimum {fmtHuf(m.params.guaranteedMin)} Ft</span>
        </div>
        <div className="row">
          <Link className="btn" href={`/c/${cid}/payroll/people`}><Users size={16} /> Dolgozók és jogviszonyok</Link>
          <Link className="btn" href={`/c/${cid}/payroll/params?year=${period.slice(0, 4)}`}><SlidersHorizontal size={16} /> Paraméterek</Link>
        </div>
      </div>
      <Flash error={sp.error} ok={sp.ok} />

      <div className="row" style={{ alignItems: "center", marginBottom: 12, gap: 8 }}>
        <Link className="btn" href={`?period=${shift(period, -1)}`}><ChevronLeft size={16} /> {MONTH[Number(shift(period, -1).slice(5)) - 1]}</Link>
        <form className="row" style={{ gap: 6 }}><input type="month" name="period" defaultValue={period} /><button>Ugrás</button></form>
        <Link className="btn" href={`?period=${shift(period, 1)}`}>{MONTH[Number(shift(period, 1).slice(5)) - 1]} <ChevronRight size={16} /></Link>
        {posted
          ? <span className="badge posted"><CircleCheck size={12} /> könyvelve</span>
          : external ? <span className="badge posted"><CircleCheck size={12} /> kézzel könyvelve</span>
          : <span className="badge draft">nincs könyvelve</span>}
        {open.filter((p) => p !== period).length > 0 && (
          <span className="badge overdue" title="Élő jogviszony mellett nem könyvelt hónapok">
            <TriangleAlert size={12} /> könyveletlen: {open.filter((p) => p !== period).map((p) => <Link key={p} href={`?period=${p}`} style={{ marginLeft: 4 }}>{p.slice(5)}.</Link>)}
          </span>
        )}
      </div>

      {!posted && m.manualHits.length > 0 && (
        <div className={`flash ${external ? "ok" : "error"}`} style={{ marginBottom: 12 }}>
          {external ? "Ennek a hónapnak a bére kézi tétellel van könyvelve: " : "Ebben a hónapban már van kézzel könyvelt bértétel – a modul nem könyvel rá (dupla könyvelés lenne): "}
          {m.manualHits.map((h, i) => <span key={h.id}>{i ? ", " : ""}<Link href={`/c/${cid}/journal/${h.id}/edit`} title={h.description}>{h.number}</Link></span>)}.
          {!external && canWrite && (
            <form action={markExternalAction} style={{ display: "inline", marginLeft: 8 }}>
              <input type="hidden" name="cid" value={cid} /><input type="hidden" name="period" value={period} /><input type="hidden" name="on" value="1" />
              <button className="primary small">Kézzel könyveltnek jelölöm</button>
            </form>
          )}
        </div>
      )}
      {external && canWrite && (
        <form action={markExternalAction} className="row" style={{ marginBottom: 12 }}>
          <input type="hidden" name="cid" value={cid} /><input type="hidden" name="period" value={period} /><input type="hidden" name="on" value="0" />
          <button className="small">„Kézzel könyvelve” jelölés levétele</button>
        </form>
      )}

      <PayrollGrid
        key={`${period}-${posted ? "posted" : external ? "external" : "open"}`}
        cid={cid} period={period} params={m.params} locked={posted || external || !canWrite}
        rows={m.rows.map((r) => ({ employmentId: r.employmentId, name: r.name, position: r.position, employment: r.employment, input: r.input, ytd: r.ytd }))}
      />

      {m.rows.length > 0 && (
        <>
          <h2 style={{ marginTop: 20 }}>Könyvelés és bevallás</h2>
          <div className="grid cols-2" style={{ alignItems: "start", gap: 14 }}>
            <div className="card">
              <table className="cv-calc">
                <tbody>
                  <tr><td>Bruttó bérek (T 541 / K 471)</td><td className="num">{fmtHuf(t.gross)}</td></tr>
                  <tr><td>SZJA-előleg (K 462)</td><td className="num">{fmtHuf(t.szja)}</td></tr>
                  <tr><td>TB-járulék (K 463)</td><td className="num">{fmtHuf(t.tb)}</td></tr>
                  {t.tbCompany > 0 && <tr><td>Társas vállalkozó min. járulék – a cég viseli (T {m.params.memberTbAccount} / K 463)</td><td className="num">{fmtHuf(t.tbCompany)}</td></tr>}
                  <tr><td>Szociális hozzájárulási adó (T 561 / K 463)</td><td className="num">{fmtHuf(t.szocho)}</td></tr>
                  {t.efoTax > 0 && <tr><td>EFO közteher (T 561 / K 463)</td><td className="num">{fmtHuf(t.efoTax)}</td></tr>}
                  {t.benefitTotal > 0 && <tr><td>Béren kívüli juttatás (T 551 / K 471)</td><td className="num">{fmtHuf(t.benefitTotal)}</td></tr>}
                  {t.benefitSzja + t.benefitSzocho > 0 && <tr><td>Juttatás közterhe (SZJA K 462, szocho K 463)</td><td className="num">{fmtHuf(t.benefitSzja + t.benefitSzocho)}</td></tr>}
                  <tr className="total"><td>NAV-nak fizetendő (462 + 463)</td><td className="num">{fmtHuf(t.szja + t.tb + t.tbCompany + t.szocho + t.efoTax + t.benefitSzja + t.benefitSzocho)}</td></tr>
                </tbody>
              </table>
              <p className="muted small" style={{ marginBottom: 0 }}>
                Bevallás: 08-as, a tárgyhót követő hó 12-ig ({`${shift(period, 1)}-12`}). Könyvelés dátuma: {periodEnd(period)}.
                A nettó bér kifizetése és az adók befizetése a bank- / pénztártételekkel (T 471 / K 38x, T 462–463 / K 38x).
              </p>
            </div>
            <div className="card">
              <h3 style={{ marginTop: 0 }}>08 összesítő – személyenként</h3>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Név</th><th className="num">Jövedelem</th><th className="num">SZJA</th><th className="num">TB</th><th className="num">Szocho</th><th className="num">EFO</th></tr></thead>
                  <tbody>
                    {m.rows.map((r) => (
                      <tr key={r.employmentId}>
                        <td>{r.name}</td><td className="num">{fmtHuf(r.result.gross)}</td><td className="num">{fmtHuf(r.result.szja + r.result.benefitSzja)}</td>
                        <td className="num">{fmtHuf(r.result.tb + r.result.tbCompany)}</td><td className="num">{fmtHuf(r.result.szocho + r.result.benefitSzocho)}</td><td className="num">{fmtHuf(r.result.efoTax)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {canWrite && (
                <div className="row" style={{ marginTop: 12 }}>
                  {posted ? (
                    <form action={unpostPayrollAction}>
                      <input type="hidden" name="cid" value={cid} /><input type="hidden" name="period" value={period} />
                      <ConfirmButton message={`Visszavonod a(z) ${period} bérszámfejtés könyvelését? Storno tétel készül ${periodEnd(period)} dátummal.`} pendingText="Visszavonás…">Könyvelés visszavonása</ConfirmButton>
                    </form>
                  ) : external ? (
                    <span className="muted small">Kézzel könyvelt hónap – a modul nem könyvel.</span>
                  ) : (
                    <form action={postPayrollAction}>
                      <input type="hidden" name="cid" value={cid} /><input type="hidden" name="period" value={period} />
                      {m.manualHits.length > 0 && <input type="hidden" name="force" value="1" />}
                      <ConfirmButton className={m.manualHits.length ? "danger" : "primary"} message={m.manualHits.length ? `FIGYELEM: ebben a hónapban már van kézi bértétel (${m.manualHits.map((h) => h.number).join(", ")}). Csak akkor könyveld, ha az nem ugyanennek a bérnek a könyvelése. Mégis könyveljem?` : `Könyveljem a(z) ${period} bérszámfejtést (${periodEnd(period)}, VN)? Előtte mentsd a bértáblát.`} pendingText="Könyvelés…">{m.manualHits.length ? "Mégis könyvelem" : "Hónap könyvelése"}</ConfirmButton>
                    </form>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
