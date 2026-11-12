/** v2.0 – Költség rögzítése (vendégház): gyors űrlap + a legutóbbi kézi költségtételek. */
import { notFound } from "next/navigation";
import { and, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCompany } from "@/lib/auth";
import { isPrivate } from "@/lib/entity";
import { fmtDate, today } from "@/lib/dates";
import { fmtHuf } from "@/lib/money";
import { PNL_LINES, pnlKey } from "@/lib/gh-calc";
import { Flash } from "@/components/Flash";
import { addCostAction, ghReverseAction } from "../actions";

export default async function CostsPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  const { company } = await requireCompany(cid);
  if (!isPrivate(company)) notFound();

  const accs = await db
    .select({ id: schema.accounts.id, code: schema.accounts.code, name: schema.accounts.name })
    .from(schema.accounts)
    .where(and(eq(schema.accounts.companyId, cid), eq(schema.accounts.isPosting, true), eq(schema.accounts.isActive, true), or(like(schema.accounts.code, "5%"), like(schema.accounts.code, "8%"), like(schema.accounts.code, "38%"))));
  const costAccs = accs.filter((a) => (a.code.startsWith("5") || a.code.startsWith("8")) && !["521", "571", "877", "876"].includes(a.code)).sort((a, b) => a.code.localeCompare(b.code));
  const banks = accs.filter((a) => a.code.startsWith("38") && !a.code.startsWith("389")).sort((a, b) => (a.code === "384" ? -1 : b.code === "384" ? 1 : a.code.localeCompare(b.code)));

  // legutóbbi kézi költségtételek
  const costIds = accs.filter((a) => a.code.startsWith("5") || a.code.startsWith("8")).map((a) => a.id);
  const recent = costIds.length
    ? await db
        .select({ id: schema.journalEntries.id, date: schema.journalEntries.date, description: schema.journalEntries.description, code: schema.accounts.code, name: schema.accounts.name, amount: sql<number>`(${schema.journalLines.debit} - ${schema.journalLines.credit})::float8` })
        .from(schema.journalLines)
        .innerJoin(schema.journalEntries, eq(schema.journalEntries.id, schema.journalLines.entryId))
        .innerJoin(schema.accounts, eq(schema.accounts.id, schema.journalLines.accountId))
        .where(and(eq(schema.journalLines.companyId, cid), inArray(schema.journalLines.accountId, costIds), eq(schema.journalEntries.sourceType, "manual"), sql`${schema.journalEntries.reversedById} is null`, sql`${schema.journalEntries.reversalOfId} is null`))
        .orderBy(desc(schema.journalEntries.date), desc(schema.journalEntries.id))
        .limit(60)
    : [];

  return (
    <div className="gh">
      <Flash error={sp.error} ok={sp.ok} />
      <h1>Költség rögzítése</h1>
      <form action={addCostAction} className="card">
        <input type="hidden" name="cid" value={cid} />
        <div className="form-grid">
          <label>Dátum<input type="date" name="date" defaultValue={today()} required /></label>
          <label>Kategória
            <select name="account" defaultValue="526" required>
              {costAccs.map((a) => {
                const k = pnlKey(a.code);
                return <option key={a.code} value={a.code}>{a.name}{k ? ` → ${PNL_LINES[k]}` : ""}</option>;
              })}
            </select>
          </label>
          <label>Összeg (bruttó Ft)<input name="amount" className="num" inputMode="numeric" required placeholder="110 000" /></label>
          <label>Megnevezés<input name="description" required placeholder="pl. Takarítás, Tűzifa 2 m³" /></label>
          <label>Miből fizetted
            <select name="pay" defaultValue="4191">
              <option value="4191">Magánpénzből / készpénzzel</option>
              {banks.map((b) => <option key={b.code} value={b.code}>Bankszámláról – {b.name}</option>)}
            </select>
          </label>
          <label>Ismétlés (hónap)<input name="repeat" type="number" min={1} max={36} defaultValue={1} className="num" /></label>
        </div>
        <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, color: "var(--ink)" }}>
          <input type="checkbox" name="monthly" /> Havi díj – a hónap utolsó napjára könyvelve, a kimutatásokban a hónap napjaira osztva (pl. takarítás, havi anyagköltség)
        </label>
        <div className="row" style={{ marginTop: 12 }}><button className="primary">Rögzítés</button><span className="muted" style={{ fontSize: 12.5 }}>Ismétlésnél ugyanaz az összeg kerül a következő hónapokra is.</span></div>
      </form>

      <h2>Legutóbbi kézzel rögzített költségek</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Dátum</th><th>Megnevezés</th><th>Kategória</th><th className="num">Összeg</th><th></th></tr></thead>
          <tbody>
            {recent.map((r) => (
              <tr key={`${r.id}-${r.code}`}>
                <td>{fmtDate(r.date)}</td>
                <td>{r.description}</td>
                <td>{r.name}</td>
                <td className="num">{fmtHuf(r.amount)}</td>
                <td>
                  <form action={ghReverseAction}>
                    <input type="hidden" name="cid" value={cid} />
                    <input type="hidden" name="page" value="costs" />
                    <input type="hidden" name="entryId" value={r.id} />
                    <button className="danger" style={{ padding: "3px 8px", fontSize: 12 }}>Törlés</button>
                  </form>
                </td>
              </tr>
            ))}
            {recent.length === 0 && <tr><td colSpan={5} className="muted">Még nincs kézzel rögzített költség.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: 12.5 }}>A számlával érkező költségek (MVM, víz, Airbnb jutalék) a bizonylatok közül jönnek; a törlés sztornó tétellel történik, az eredeti megmarad a naplóban.</p>
    </div>
  );
}
