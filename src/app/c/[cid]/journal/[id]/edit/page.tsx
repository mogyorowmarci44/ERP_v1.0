import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCompany } from "@/lib/auth";
import { formOptions } from "@/lib/options";
import { canEditEntry } from "@/lib/journal-edit";
import { updateManualEntryAction, toggleEntryCheckAction } from "../../../actions";
import { Flash } from "@/components/Flash";
import { SubmitButton } from "@/components/SubmitButton";
import { fmtHuf } from "@/lib/money";
import { fmtDate } from "@/lib/dates";

const FIELD_HU: Record<string, string> = {
  invoice_line: "Számlatétel megnevezése", entry_description: "Megnevezés", date: "Dátum", description: "Sor szövege", partner: "Partner", vehicle: "Gépkocsi",
  account: "Főkönyvi számla", debit: "Tartozik", credit: "Követel", amount_fx: "Devizaösszeg", line_added: "Új sor", line_deleted: "Törölt sor",
  invoice_repost: "Számla újrakönyvelve", payment_edit: "Rendezés javítva",
};
const fmtAt = (d: Date) => new Date(d).toLocaleString("hu-HU", { timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const NEW_ROWS = 3;

export default async function EditEntryPage({ params, searchParams }: { params: Promise<{ cid: string; id: string }>; searchParams: Promise<Record<string, string>> }) {
  const { cid: c, id: i } = await params;
  const cid = Number(c), id = Number(i);
  const sp = await searchParams;
  const { role } = await requireCompany(cid);
  const [e] = await db.select().from(schema.journalEntries).where(and(eq(schema.journalEntries.id, id), eq(schema.journalEntries.companyId, cid)));
  if (!e) notFound();
  const lines = await db.select().from(schema.journalLines).where(eq(schema.journalLines.entryId, id)).orderBy(asc(schema.journalLines.id));
  const history = await db
    .select({ h: schema.journalLineChanges, user: schema.users.name })
    .from(schema.journalLineChanges).leftJoin(schema.users, eq(schema.users.id, schema.journalLineChanges.userId))
    .where(eq(schema.journalLineChanges.entryId, id)).orderBy(desc(schema.journalLineChanges.changedAt));
  const o = await formOptions(cid, lines.map((x) => x.vehicleId).filter((v): v is number => !!v));
  const accounts = [...o.accounts];
  for (const l of lines) if (!accounts.some((a) => a.id === l.accountId)) {
    const [a] = await db.select().from(schema.accounts).where(eq(schema.accounts.id, l.accountId));
    if (a) accounts.push({ id: a.id, code: a.code, name: a.name, currency: a.currency });
  }
  const canWrite = role !== "viewer";
  const editable = canEditEntry(e) && canWrite;
  const lineNo = new Map(lines.map((x, n) => [x.id, n + 1]));
  const td = lines.reduce((s, l) => s + Number(l.debit), 0), tc = lines.reduce((s, l) => s + Number(l.credit), 0);
  const isInvoice = e.sourceType === "invoice" || e.sourceType === "payment";

  const row = (key: string, l?: (typeof lines)[number]) => (
    <tr key={key}>
      <td>{l ? lineNo.get(l.id) : "új"}<input type="hidden" name="row" value={key} /></td>
      <td>
        <select name={`${key}:accountId`} defaultValue={l?.accountId ?? ""} disabled={!editable} style={{ maxWidth: 260 }}>
          <option value="">– számla –</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}{a.currency !== "HUF" ? ` (${a.currency})` : ""}</option>)}
        </select>
      </td>
      <td><input name={`${key}:debit`} className="num" style={{ width: 110 }} defaultValue={l && Number(l.debit) ? Number(l.debit) : ""} disabled={!editable} /></td>
      <td><input name={`${key}:credit`} className="num" style={{ width: 110 }} defaultValue={l && Number(l.credit) ? Number(l.credit) : ""} disabled={!editable} /></td>
      <td><input name={`${key}:amountFx`} className="num" style={{ width: 90 }} defaultValue={l?.amountFx ? Number(l.amountFx) : ""} placeholder="deviza" disabled={!editable} /></td>
      <td><input name={`${key}:description`} defaultValue={l?.description ?? ""} disabled={!editable} /></td>
      <td>
        <select name={`${key}:partnerId`} defaultValue={l?.partnerId ?? ""} disabled={!editable} style={{ maxWidth: 180 }}>
          <option value="">–</option>
          {o.partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </td>
      <td>
        <select name={`${key}:vehicleId`} defaultValue={l?.vehicleId ?? ""} disabled={!editable} style={{ maxWidth: 180 }}>
          <option value="">–</option>
          {o.vehicles.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
        </select>
      </td>
      <td>{l && editable && <label className="check" title="Sor törlése"><input type="checkbox" name={`${key}:remove`} value="1" /> törlés</label>}</td>
    </tr>
  );

  return (
    <>
      <div className="topbar">
        <h1>{e.number} · {fmtDate(e.date)}</h1>
        <div className="row">
          {canWrite && !e.reversalOfId && (
            <form action={toggleEntryCheckAction}>
              <input type="hidden" name="cid" value={cid} /><input type="hidden" name="entryId" value={id} />
              <input type="hidden" name="on" value={e.checkedAt ? "0" : "1"} /><input type="hidden" name="back" value={`/c/${cid}/journal/${id}/edit`} />
              <button className={e.checkedAt ? "primary" : undefined}>{e.checkedAt ? "✓ Ellenőrzött – jelölés levétele" : "Megjelölés ellenőrzöttként"}</button>
            </form>
          )}
          <Link className="btn" href={`/c/${cid}/journal?from=${e.date}&to=${e.date}`}>Vissza a naplóhoz</Link>
        </div>
      </div>
      <Flash error={sp.error} ok={sp.ok} />
      <p className="muted">
        {editable
          ? "Minden adat javítható: dátum, megnevezés, főkönyvi számla, összeg, deviza, szöveg, partner, gépkocsi; sor hozzáadható és törölhető. A tétel egyensúlyban kell maradjon. Minden módosítás naplózva van."
          : e.checkedAt
            ? "Ez a tétel ellenőrzöttnek van jelölve, ezért zárolt. A javításhoz előbb vedd le a jelölést."
            : isInvoice
              ? <>Ez a tétel számlából / pénzügyi rendezésből jön – a számlánál javítható: <Link href={`/c/${cid}/invoices/${e.sourceId}`}>számla megnyitása</Link>.</>
              : "Ez a tétel itt nem javítható (sztornó, sztornózott vagy tagi kölcsön tétel)."}
      </p>
      <form action={updateManualEntryAction}>
        <input type="hidden" name="cid" value={cid} />
        <input type="hidden" name="entryId" value={id} />
        <div className="card form-grid" style={{ marginBottom: 12 }}>
          <label>Dátum<input type="date" name="date" defaultValue={e.date} required disabled={!editable} /></label>
          <label style={{ gridColumn: "span 3" }}>Megnevezés<input name="description" defaultValue={e.description} required disabled={!editable} /></label>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>#</th><th>Főkönyvi számla</th><th className="num">Tartozik</th><th className="num">Követel</th><th className="num">Deviza</th><th>Szöveg</th><th>Partner</th><th>Gépkocsi</th><th /></tr></thead>
            <tbody>
              {lines.map((l) => row(`l${l.id}`, l))}
              {editable && Array.from({ length: NEW_ROWS }, (_, n) => row(`n${n + 1}`))}
            </tbody>
            <tfoot><tr><td /><td className="muted">Jelenlegi összesen</td><td className="num">{fmtHuf(td)}</td><td className="num">{fmtHuf(tc)}</td><td colSpan={5} /></tr></tfoot>
          </table>
        </div>
        {editable && <div style={{ marginTop: 12 }}><SubmitButton className="primary">Mentés</SubmitButton> <span className="muted">Több új sorhoz ments, és újabb üres sorok jelennek meg.</span></div>}
      </form>

      <h2>Módosítások</h2>
      {history.length === 0 ? <p className="muted">Még nem módosították.</p> : (
        <table>
          <thead><tr><th>Időpont</th><th>Felhasználó</th><th>Sor</th><th>Mező</th><th>Régi érték</th><th>Új érték</th></tr></thead>
          <tbody>
            {history.map(({ h, user }) => (
              <tr key={h.id}>
                <td>{fmtAt(h.changedAt)}</td><td>{user ?? "–"}</td><td>{h.lineId ? lineNo.get(h.lineId) ?? "" : "fej"}</td>
                <td>{FIELD_HU[h.field] ?? h.field}</td><td className="muted">{h.oldValue ?? "–"}</td><td>{h.newValue ?? "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
