"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { CalendarDays } from "lucide-react";
import { AttendanceCalendar } from "./AttendanceCalendar";
import { useRouter } from "next/navigation";
import { savePayrollAction } from "@/app/c/[cid]/payroll/actions";
import { calcPayroll, isEfo, KIND_SHORT, sumResults, type Employment, type PayrollInput, type PayrollParams, type YearToDate } from "@/lib/payroll-calc";

type Row = { employmentId: number; name: string; position: string | null; employment: Employment; input: PayrollInput; ytd: YearToDate };
const fmt = new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 0, useGrouping: "always" });
const f = (n: number) => fmt.format(Math.round(n) || 0);
const benefitOf = (i: PayrollInput, k: "szep" | "ejm" | "taxfree") => (i.benefits ?? []).filter((b) => b.kind === k).reduce((s, b) => s + Number(b.amount || 0), 0);

/** Havi bértábla: soronként egy jogviszony, élő számolással; mentés a szerverre. */
export function PayrollGrid({ cid, period, params, rows, locked }: { cid: number; period: string; params: PayrollParams; rows: Row[]; locked: boolean }) {
  const router = useRouter();
  const [inputs, setInputs] = useState<Record<number, PayrollInput>>(() => Object.fromEntries(rows.map((r) => [r.employmentId, r.input])));
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [pending, start] = useTransition();
  const [openCal, setOpenCal] = useState<Set<number>>(new Set());
  const toggleCal = (id: number) => setOpenCal((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const results = useMemo(() => rows.map((r) => calcPayroll(r.employment, inputs[r.employmentId] ?? {}, params, period, r.ytd)), [rows, inputs, params, period]);
  const tot = sumResults(results);

  const set = (id: number, patch: (i: PayrollInput) => PayrollInput) => { setInputs((x) => ({ ...x, [id]: patch(x[id] ?? {}) })); setDirty(true); setMsg(null); };
  const setNum = (id: number, k: "otHours50" | "otHours100" | "bonus" | "efoDays", v: string) => set(id, (i) => ({ ...i, [k]: Number(v.replace(/\s/g, "").replace(",", ".")) || 0 }));
  const setBen = (id: number, k: "szep" | "ejm" | "taxfree", v: string) => set(id, (i) => ({ ...i, benefits: [...(i.benefits ?? []).filter((b) => b.kind !== k), ...(Number(v.replace(/\s/g, "")) > 0 ? [{ kind: k, amount: Number(v.replace(/\s/g, "")) }] : [])] }));
  const setDays = (r: Row, days: NonNullable<PayrollInput["days"]>) => set(r.employmentId, (i) => {
    const next = { ...i, days };
    // EFO: az alkalmi napok száma a naptárból jön
    if (isEfo(r.employment.kind) && Object.keys(days).length) next.efoDays = Object.values(days).filter((c) => c === "M").length;
    return next;
  });
  const save = () => start(async () => {
    const r = await savePayrollAction(cid, period, inputs);
    if (r.error) setMsg({ error: r.error }); else { setMsg({ ok: "Mentve." }); setDirty(false); router.refresh(); }
  });

  const cell = (id: number, v: number | undefined, onChange: (v: string) => void, show = true, w = 64) =>
    show ? <input inputMode="decimal" className="pr-in" style={{ width: w }} disabled={locked} defaultValue={v ? String(v) : ""} onChange={(e) => onChange(e.target.value)} aria-label="érték" /> : <span className="muted">–</span>;

  if (!rows.length) return <p className="muted">Ebben a hónapban nincs élő jogviszony. Vegyél fel dolgozót a „Dolgozók és jogviszonyok” oldalon.</p>;

  return (
    <div className="grid" style={{ gap: 10 }}>
      <div className="table-wrap">
        <table className="pr-table">
          <thead>
            <tr>
              <th>Név · jogviszony</th><th className="num">Alap</th><th className="num" title="Túlóra 50% pótlékkal (óra)">Túlóra 50% (ó)</th><th className="num" title="Túlóra 100% pótlékkal (pihenőnap / ünnepnap, óra)">Túlóra 100% (ó)</th>
              <th className="num">Prémium</th><th className="num">Alkalmi nap</th><th className="num">SZÉP</th><th className="num" title="Egyes meghatározott juttatás (33,04%)">Egyéb juttatás</th>
              <th className="num">Bruttó</th><th className="num" title="TB-járulék 18,5% (társas vállalkozónál a minimum alap után, a cég viseli)">TB-járulék</th><th className="num" title="Szociális hozzájárulási adó 13% (+ juttatás és EFO közteher)">Szocho / közteher</th><th className="num">Nettó</th><th className="num">Cég költsége</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const x = results[i], e = r.employment, efo = isEfo(e.kind), inp = inputs[r.employmentId] ?? {};
              const calUsed = !!x.attendance;
              return (
                <Fragment key={r.employmentId}>
                <tr>
                  <td>
                    <button type="button" className={`att-toggle${calUsed ? " used" : ""}`} title="Jelenléti naptár" aria-expanded={openCal.has(r.employmentId)} onClick={() => toggleCal(r.employmentId)}><CalendarDays size={15} /></button>{" "}
                    <strong>{r.name}</strong>{r.position ? <span className="muted small"> · {r.position}</span> : null}
                    <div><span className={`badge ${efo ? "posted" : e.kind === "member" ? "" : "draft"}`}>{KIND_SHORT[e.kind]}</span>{x.prorate > 0 && x.prorate < 1 && <span className="muted small"> · {Math.round(x.prorate * 100)}% hónap</span>}
                      {x.attendance && !efo && (x.attendance.leave + x.attendance.sick + x.attendance.unpaid) > 0 && <span className="muted small"> · távollét: {[x.attendance.leave && `${x.attendance.leave} SZ`, x.attendance.sick && `${x.attendance.sick} B`, x.attendance.unpaid && `${x.attendance.unpaid} T/F`].filter(Boolean).join(", ")}</span>}</div>
                  </td>
                  <td className="num">{efo ? `${f(e.dailyWage)} / nap` : f(x.base)}
                    {x.absenceDeduction > 0 && <div className="small neg" title="Távollét miatti levonás (betegszabadság, táppénz, fizetés nélküli)">−{f(x.absenceDeduction)}</div>}
                    {x.sickPay > 0 && <div className="small" title="Betegszabadság-díj (70%)">+{f(x.sickPay)} beteg</div>}
                  </td>
                  <td className="num">{cell(r.employmentId, inp.otHours50, (v) => setNum(r.employmentId, "otHours50", v), !efo && e.kind !== "member", 44)}</td>
                  <td className="num">{cell(r.employmentId, inp.otHours100, (v) => setNum(r.employmentId, "otHours100", v), !efo && e.kind !== "member", 44)}</td>
                  <td className="num">{cell(r.employmentId, inp.bonus, (v) => setNum(r.employmentId, "bonus", v), !efo, 64)}</td>
                  <td className="num">{efo && calUsed ? <span title="A jelenléti naptárból">{x.attendance!.efoDays}</span> : cell(r.employmentId, inp.efoDays, (v) => setNum(r.employmentId, "efoDays", v), efo, 44)}</td>
                  <td className="num">{cell(r.employmentId, benefitOf(inp, "szep"), (v) => setBen(r.employmentId, "szep", v), true, 64)}</td>
                  <td className="num">{cell(r.employmentId, benefitOf(inp, "ejm"), (v) => setBen(r.employmentId, "ejm", v), true, 64)}</td>
                  <td className="num">{f(x.gross)}</td>
                  <td className="num">{f(x.tb + x.tbCompany)}</td>
                  <td className="num">{f(x.szocho + x.efoTax + x.benefitSzja + x.benefitSzocho)}</td>
                  <td className="num">{f(x.net)}</td>
                  <td className="num"><strong>{f(x.employerCost)}</strong></td>
                </tr>
                {openCal.has(r.employmentId) && (
                  <tr className="att-row"><td colSpan={13}>
                    <AttendanceCalendar employment={e} period={period} days={inp.days} attendance={x.attendance} locked={locked} onChange={(d) => setDays(r, d)} />
                  </td></tr>
                )}
                {x.warnings.length > 0 && (
                  <tr className="pr-warn"><td colSpan={13}>{x.warnings.map((w, k) => <div key={k}>⚠ {w}</div>)}</td></tr>
                )}
                </Fragment>
              );
            })}
            <tr className="pr-total">
              <td>Összesen</td><td /><td /><td /><td /><td />
              <td className="num" colSpan={2}>{f(tot.benefitTotal)}</td>
              <td className="num">{f(tot.gross)}</td><td className="num">{f(tot.tb + tot.tbCompany)}</td><td className="num">{f(tot.szocho + tot.efoTax + tot.benefitSzja + tot.benefitSzocho)}</td><td className="num">{f(tot.net)}</td><td className="num">{f(tot.employerCost)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {!locked && (
        <div className="row" style={{ alignItems: "center" }}>
          <button className={dirty ? "primary" : ""} onClick={save} disabled={pending}>{pending ? "Mentés…" : "Bértábla mentése"}</button>
          {dirty && <span className="muted small">Nem mentett változás – könyvelés előtt mentsd.</span>}
          {msg?.ok && <span className="small" style={{ color: "var(--pos)" }}>{msg.ok}</span>}
          {msg?.error && <span className="small neg">{msg.error}</span>}
        </div>
      )}
      <div className="grid cols-4 lp-kpi">
        <div className="card stat"><div className="label">Nettó kifizetés</div><div className="value">{f(tot.net)}</div></div>
        <div className="card stat"><div className="label">SZJA (462)</div><div className="value">{f(tot.szja + tot.benefitSzja)}</div></div>
        <div className="card stat"><div className="label">Járulék + szocho (463)</div><div className="value">{f(tot.tb + tot.tbCompany + tot.szocho + tot.efoTax + tot.benefitSzocho)}</div></div>
        <div className="card stat"><div className="label">A cég összes költsége</div><div className="value">{f(tot.employerCost)}</div></div>
      </div>
    </div>
  );
}
