import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCompany } from "@/lib/auth";
import { formOptions } from "@/lib/options";
import { canEditMeta } from "@/lib/journal-edit";
import { updateEntryMetaAction } from "../../../actions";
import { Flash } from "@/components/Flash";
import { SubmitButton } from "@/components/SubmitButton";
import { fmtHuf } from "@/lib/money";
import { fmtDate } from "@/lib/dates";

const FIELD_HU: Record<string, string> = { entry_description: "Megnevezés", description: "Sor szövege", partner: "Partner", vehicle: "Gépkocsi" };
const fmtAt = (d: Date) => new Date(d).toLocaleString("hu-HU", { timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

export default async function EditEntryPage({ params, searchParams }: { params: Promise<{ cid: string; id: string }>; searchParams: Promise<Record<string, string>> }) {
  const { cid: c, id: i } = await params;
  const cid = Number(c), id = Number(i);
  const sp = await searchParams;
  const { role } = await requireCompany(cid);
  const [e] = await db.select().from(schema.journalEntries).where(and(eq(schema.journalEntries.id, id), eq(schema.journalEntries.companyId, cid)));
  if (!e) notFound();
  const lines = await db
    .select({ l: schema.journalLines, code: schema.accounts.code, name: schema.accounts.name })
    .from(schema.journalLines).innerJoin(schema.accounts, eq(schema.accounts.id, schema.journalLines.accountId))
    .where(eq(schema.journalLines.entryId, id)).orderBy(asc(schema.journalLines.id));
  const history = await db
    .select({ h: schema.journalLineChanges, user: schema.users.name })
    .from(schema.journalLineChanges).leftJoin(schema.users, eq(schema.users.id, schema.journalLineChanges.userId))
    .where(eq(schema.journalLineChanges.entryId, id)).orderBy(desc(schema.journalLineChanges.changedAt));
  const o = await formOptions(cid, lines.map((x) => x.l.vehicleId).filter((v): v is number => !!v));
  const editable = canEditMeta(e) && role !== "viewer";
  const lineNo = new Map(lines.map((x, n) => [x.l.id, n + 1]));

  return (
    <>
      <div className="topbar">
        <h1>{e.number} · {fmtDate(e.date)}</h1>
        <Link className="btn" href={`/c/${cid}/journal?from=${e.date}&to=${e.date}`}>Vissza a naplóhoz</Link>
      </div>
      <Flash error={sp.error} ok={sp.ok} />
      <p className="muted">
        {editable
          ? "A megnevezés, a sorok szövege, partnere és gépkocsija módosítható. Összeget, főkönyvi számlát vagy dátumot sztornóval és új tétellel javíts. Minden módosítás naplózva van."
          : "Ez a tétel nem szerkeszthető: csak nem sztornózott kézi (vegyes / bank / pénztár) tétel adatai módosíthatók. Számlából származó tételt a számlánál javíts."}
      </p>
      <form action={updateEntryMetaAction}>
        <input type="hidden" name="cid" value={cid} />
        <input type="hidden" name="entryId" value={id} />
        <div className="card form-grid" style={{ marginBottom: 12 }}>
          <label style={{ gridColumn: "1 / -1" }}>Megnevezés<input name="description" defaultValue={e.description} required disabled={!editable} /></label>
        </div>
        <table>
          <thead><tr><th>#</th><th>Főkönyvi számla</th><th className="num">Tartozik</th><th className="num">Követel</th><th>Szöveg</th><th>Partner</th><th>Gépkocsi</th></tr></thead>
          <tbody>
            {lines.map(({ l, code, name }, n) => (
              <tr key={l.id}>
                <td>{n + 1}<input type="hidden" name="lineId" value={l.id} /></td>
                <td className="mono">{code} <span className="muted">{name}</span></td>
                <td className="num">{Number(l.debit) ? fmtHuf(Number(l.debit)) : ""}</td>
                <td className="num">{Number(l.credit) ? fmtHuf(Number(l.credit)) : ""}</td>
                <td><input name={`desc_${l.id}`} defaultValue={l.description ?? ""} disabled={!editable} /></td>
                <td>
                  <select name={`partner_${l.id}`} defaultValue={l.partnerId ?? ""} disabled={!editable}>
                    <option value="">–</option>
                    {o.partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </td>
                <td>
                  <select name={`vehicle_${l.id}`} defaultValue={l.vehicleId ?? ""} disabled={!editable}>
                    <option value="">–</option>
                    {o.vehicles.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {editable && <div style={{ marginTop: 12 }}><SubmitButton className="primary">Mentés</SubmitButton></div>}
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
