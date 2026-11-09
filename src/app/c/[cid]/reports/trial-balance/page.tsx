import Link from "next/link";
import { requireCompany } from "@/lib/auth";
import { trialBalance } from "@/lib/reports";
import { fmtHuf } from "@/lib/money";
import { isDate, yearStart, monthEnd, today, fmtDate } from "@/lib/dates";

export default async function TrialBalancePage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  const { company } = await requireCompany(cid);
  const from = isDate(sp.from) ? sp.from : yearStart();
  const to = isDate(sp.to) ? sp.to : monthEnd(today());
  const level = Number(sp.level) || 0; // 0 = analitikus, 1/2/3 = szintenkénti összesítés
  let rows = await trialBalance(cid, from, to);
  if (level > 0) {
    const m = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      const k = r.code.slice(0, level);
      const cur = m.get(k) ?? { ...r, code: k, name: `${k}. számlacsoport`, accountId: 0, openingDebit: 0, openingCredit: 0, periodDebit: 0, periodCredit: 0, closingDebit: 0, closingCredit: 0 };
      const o = cur.openingDebit - cur.openingCredit + r.openingDebit - r.openingCredit;
      const c = cur.closingDebit - cur.closingCredit + r.closingDebit - r.closingCredit;
      cur.openingDebit = Math.max(o, 0); cur.openingCredit = Math.max(-o, 0);
      cur.closingDebit = Math.max(c, 0); cur.closingCredit = Math.max(-c, 0);
      cur.periodDebit += r.periodDebit; cur.periodCredit += r.periodCredit;
      m.set(k, cur);
    }
    rows = [...m.values()].sort((a, b) => a.code.localeCompare(b.code));
  }
  const tot = (k: keyof (typeof rows)[number]) => rows.reduce((s, r) => s + (r[k] as number), 0);
  return (
    <>
      <div className="topbar">
        <h1>Főkönyvi kivonat</h1>
        <span className="muted">{company.name} · {fmtDate(from)} – {fmtDate(to)}</span>
      </div>
      <form className="row card no-print" style={{ marginBottom: 12 }}>
        <label>Dátum-tól<input type="date" name="from" defaultValue={from} /></label>
        <label>-ig<input type="date" name="to" defaultValue={to} /></label>
        <label>Szint
          <select name="level" defaultValue={String(level)}>
            <option value="0">analitikus</option><option value="1">számlaosztály</option><option value="2">számlacsoport</option><option value="3">főkönyvi (3 jegy)</option>
          </select>
        </label>
        <button style={{ alignSelf: "end" }}>Lekérdezés</button>
      </form>
      <table>
        <thead>
          <tr><th rowSpan={2}>Számla</th><th rowSpan={2}>Megnevezés</th><th colSpan={2} className="num">Nyitó</th><th colSpan={2} className="num">Időszaki forgalom</th><th colSpan={2} className="num">Záró egyenleg</th></tr>
          <tr><th className="num">T</th><th className="num">K</th><th className="num">T</th><th className="num">K</th><th className="num">T</th><th className="num">K</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.code}>
              <td className="mono">{r.accountId ? <Link href={`/c/${cid}/reports/ledger?account=${r.accountId}&from=${from}&to=${to}`}>{r.code}</Link> : r.code}</td>
              <td>{r.name}</td>
              <td className="num">{fmtHuf(r.openingDebit) || ""}</td><td className="num">{fmtHuf(r.openingCredit) || ""}</td>
              <td className="num">{fmtHuf(r.periodDebit)}</td><td className="num">{fmtHuf(r.periodCredit)}</td>
              <td className="num">{r.closingDebit ? fmtHuf(r.closingDebit) : ""}</td><td className="num">{r.closingCredit ? fmtHuf(r.closingCredit) : ""}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2}>Összesen</td>
            <td className="num">{fmtHuf(tot("openingDebit"))}</td><td className="num">{fmtHuf(tot("openingCredit"))}</td>
            <td className="num">{fmtHuf(tot("periodDebit"))}</td><td className="num">{fmtHuf(tot("periodCredit"))}</td>
            <td className="num">{fmtHuf(tot("closingDebit"))}</td><td className="num">{fmtHuf(tot("closingCredit"))}</td>
          </tr>
        </tfoot>
      </table>
      <p className="muted">Mérlegszámlák (1–4) nyitója halmozott, eredményszámlák (5–9) nyitója az üzleti év elejétől számít. Évzárás (eredmény átvezetése) a következő mérföldkő.</p>
    </>
  );
}
