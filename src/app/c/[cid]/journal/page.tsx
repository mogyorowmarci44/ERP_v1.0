import Link from "next/link";
import { Fragment } from "react";
import { requireCompany } from "@/lib/auth";
import { journalList } from "@/lib/reports";
import { reverseEntryAction, toggleEntryCheckAction } from "../actions";
import { canEditMeta } from "@/lib/journal-edit";
import { Flash } from "@/components/Flash";
import { fmtHuf } from "@/lib/money";
import { fmtDate, isDate, monthStart, monthEnd, today } from "@/lib/dates";
import { PeriodPicker } from "@/components/PeriodPicker";

export default async function JournalPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  const { role } = await requireCompany(cid);
  const from = isDate(sp.from) ? sp.from : monthStart(today());
  const to = isDate(sp.to) ? sp.to : monthEnd(today());
  const j = sp.j || "";
  const entries = await journalList(cid, from, to, j || undefined);
  return (
    <>
      <div className="topbar">
        <h1>Napló</h1>
        <Link className="btn primary" href={`/c/${cid}/journal/new`}>+ Új tétel</Link>
      </div>
      <Flash error={sp.error} ok={sp.ok} />
      <form className="row card" style={{ marginBottom: 12 }}>
        <PeriodPicker unit="day" label="Dátum" from={from} to={to} today={today()} />
        <label>Napló
          <select name="j" defaultValue={j}>
            <option value="">mind</option><option value="VE">VE vevő</option><option value="SZ">SZ szállító</option><option value="BA">BA bank</option><option value="PE">PE pénztár</option><option value="VN">VN vegyes</option>
          </select>
        </label>
        <button style={{ alignSelf: "end" }}>Szűrés</button>
      </form>
      <table>
        <thead><tr><th>Tétel</th><th>Dátum</th><th>Megnevezés / számla</th><th>Partner</th><th className="num">Tartozik</th><th className="num">Követel</th><th></th></tr></thead>
        <tbody>
          {entries.map((e) => (
            <Fragment key={e.id}>
              <tr className={e.reversedById ? "reversed" : undefined}>
                <td className="mono">{e.number}</td>
                <td>{fmtDate(e.date)}</td>
                <td><strong>{e.description}</strong></td>
                <td></td><td></td><td></td>
                <td>

                  <div className="row" style={{ gap: 6, flexWrap: "nowrap", justifyContent: "flex-end" }}>
                  {role !== "viewer" && !e.reversalOfId && (
                    <form action={toggleEntryCheckAction}>
                      <input type="hidden" name="cid" value={cid} /><input type="hidden" name="entryId" value={e.id} /><input type="hidden" name="on" value={e.checkedAt ? "0" : "1"} />
                      <input type="hidden" name="back" value={`/c/${cid}/journal?from=${from}&to=${to}${j ? `&j=${j}` : ""}`} />
                      <button className={e.checkedAt ? "chk on" : "chk"} title={e.checkedAt ? "Ellenőrzött – kattintásra visszavonás (zárolás feloldása)" : "Megjelölés ellenőrzöttként (zárolja a tételt)"}>✓</button>
                    </form>
                  )}
                  {canEditMeta(e) && role !== "viewer" && <Link className="btn" href={`/c/${cid}/journal/${e.id}/edit`}>Javítás</Link>}
                  {(e.sourceType === "invoice" || e.sourceType === "payment") && !e.reversedById && !e.checkedAt && role !== "viewer" && <Link className="btn" href={`/c/${cid}/invoices/${e.sourceId}`}>Javítás</Link>}
                  </div>
                  {(e.sourceType === "manual" || e.sourceType === "member_loan") && !e.reversedById && role !== "viewer" && (
                    <form action={reverseEntryAction}><input type="hidden" name="cid" value={cid} /><input type="hidden" name="entryId" value={e.id} /><button className="danger">Sztornó</button></form>
                  )}
                </td>
              </tr>
              {e.lines.map((x) => (
                <tr key={`l${x.l.id}`} className="sub">
                  <td></td><td></td>
                  <td className="mono">{x.code} <span className="muted">{x.name}</span>{x.l.description && x.l.description !== e.description ? ` – ${x.l.description}` : ""}</td>
                  <td>{x.partnerName}</td>
                  <td className="num">{x.l.debit ? fmtHuf(x.l.debit) : ""}</td>
                  <td className="num">{x.l.credit ? fmtHuf(x.l.credit) : ""}</td>
                  <td></td>
                </tr>
              ))}
            </Fragment>
          ))}
          {entries.length === 0 && <tr><td colSpan={7} className="muted">Nincs tétel az időszakban.</td></tr>}
        </tbody>
      </table>
    </>
  );
}
