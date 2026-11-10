import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCompany } from "@/lib/auth";
import { Flash } from "@/components/Flash";
import { SubmitButton } from "@/components/SubmitButton";
import { getInboxSettings, type SyncSummary } from "@/lib/inbox/service";
import { fmtHuf } from "@/lib/money";
import { fmtDate } from "@/lib/dates";
import { syncAction, uploadAction, ignoreDocAction } from "./actions";

const STATUS_HU: Record<string, string> = {
  new: "új", extracted: "kiolvasva", review: "jóváhagyásra vár", booked: "lekönyvelve", duplicate: "már bent volt", ignored: "kihagyva", error: "hiba",
};
const TABS = [
  ["todo", "Teendő", ["review", "error", "new", "extracted"]],
  ["booked", "Lekönyvelve", ["booked"]],
  ["other", "Kihagyott / duplikált", ["ignored", "duplicate"]],
] as const;

export default async function InboxPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  const { role } = await requireCompany(cid);
  const canWrite = role !== "viewer";
  const tab = TABS.find((t) => t[0] === sp.tab) ?? TABS[0];
  const { settings, lastSyncAt } = await getInboxSettings(cid);
  const rows = await db
    .select({ id: schema.inboxDocuments.id, source: schema.inboxDocuments.source, kind: schema.inboxDocuments.kind, filename: schema.inboxDocuments.filename, status: schema.inboxDocuments.status,
      emailFrom: schema.inboxDocuments.emailFrom, emailSubject: schema.inboxDocuments.emailSubject, emailDate: schema.inboxDocuments.emailDate, createdAt: schema.inboxDocuments.createdAt,
      extracted: schema.inboxDocuments.extracted, proposal: schema.inboxDocuments.proposal, invoiceId: schema.inboxDocuments.invoiceId, error: schema.inboxDocuments.error })
    .from(schema.inboxDocuments)
    .where(and(eq(schema.inboxDocuments.companyId, cid), inArray(schema.inboxDocuments.status, [...tab[2]])))
    .orderBy(desc(schema.inboxDocuments.createdAt))
    .limit(300);
  const counts = await db.select({ status: schema.inboxDocuments.status }).from(schema.inboxDocuments).where(eq(schema.inboxDocuments.companyId, cid));
  const cnt = (st: readonly string[]) => counts.filter((c) => st.includes(c.status)).length;
  let sync: SyncSummary | null = null;
  try { sync = sp.sync ? (JSON.parse(sp.sync) as SyncSummary) : null; } catch { sync = null; }
  const connected = !!(settings.scriptUrl && settings.secretEnc);

  return (
    <>
      <div className="topbar">
        <h1>Beérkező bizonylatok</h1>
        <Link className="btn" href={`/c/${cid}/inbox/settings`}>Beállítások</Link>
      </div>
      <Flash error={sp.error} ok={sp.ok} />

      <div className="card inbox-hero" style={{ marginBottom: 14 }}>
        <div>
          <strong>Beolvasás és könyvelés</strong>
          <p className="muted" style={{ margin: "4px 0 0" }}>
            {connected ? "Forrás: Gmail + Drive (" + [settings.invoiceFolderId ? "Bejövő számlák" : null, settings.statementFolderId ? "Kivonatok" : null].filter(Boolean).join(", ") + ") és a feltöltött fájlok" : "A Google-kapcsolat még nincs beállítva – most csak a feltöltött fájlokat dolgozza fel"}
            {". "}{settings.autoPost !== false ? "Az egyértelműeket magától lekönyveli." : "Minden a jóváhagyási listába kerül."}
            {lastSyncAt && <> · utoljára: {lastSyncAt.toLocaleString("hu-HU", { timeZone: "Europe/Budapest" })}</>}
          </p>
        </div>
        {canWrite && (
          <form action={syncAction}>
            <input type="hidden" name="cid" value={cid} />
            <SubmitButton className="primary big" pendingText="Beolvasás folyamatban…">Beolvasás és könyvelés</SubmitButton>
          </form>
        )}
      </div>

      {sync && (
        <div className={`card ${sync.errors.length ? "fc-warn" : "check-panel ok"}`} style={{ marginBottom: 14 }}>
          <strong>Eredmény:</strong> {sync.fetched} új bizonylat a Google-ból · {sync.processed} feldolgozva · <span className="pos">{sync.booked} lekönyvelve</span> ·{" "}
          {sync.review} jóváhagyásra vár · {sync.duplicate} már bent volt · {sync.ignored} nem könyvelendő
          {sync.errors.length > 0 && <ul className="flag-list">{sync.errors.map((e, i) => <li key={i} className="warn">⚠ {e}</li>)}</ul>}
        </div>
      )}

      {canWrite && (
        <form action={uploadAction} className="card row" style={{ marginBottom: 14, alignItems: "end" }}>
          <input type="hidden" name="cid" value={cid} />
          <label style={{ flex: 1 }}>Kézi feltöltés (PDF, fotó, bankkivonat CSV / Excel – telefonról fotózva is)
            <input type="file" name="files" multiple accept="application/pdf,image/*,.csv,.xlsx,.xml,text/csv" />
          </label>
          <label>Típus
            <select name="kind" defaultValue="invoice"><option value="invoice">számla / nyugta / adásvételi</option><option value="statement">bankkivonat</option></select>
          </label>
          <SubmitButton pendingText="Feltöltés és kiolvasás…">Feltöltés</SubmitButton>
        </form>
      )}

      <div className="segmented" style={{ marginBottom: 12 }}>
        {TABS.map(([k, label, st]) => <Link key={k} href={`/c/${cid}/inbox?tab=${k}`} className={k === tab[0] ? "on" : undefined}>{label} ({cnt(st)})</Link>)}
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr><th>Érkezett</th><th>Forrás</th><th>Bizonylat</th><th>Partner</th><th className="num">Összeg</th><th>Állapot</th><th>Megjegyzés</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => {
              const x = r.extracted;
              const partner = x ? (x.direction === "out" ? x.buyer?.name : x.seller?.name) ?? r.proposal?.invoice?.partner.name : null;
              const total = x?.totals?.gross ?? null;
              return (
                <tr key={r.id}>
                  <td className="nowrap">{fmtDate((r.emailDate ?? r.createdAt).toISOString().slice(0, 10))}</td>
                  <td>{r.source === "gmail" ? "Gmail" : r.source === "drive" ? "Drive" : "feltöltés"}{r.kind === "statement" ? " · kivonat" : ""}</td>
                  <td>
                    <Link href={`/c/${cid}/inbox/${r.id}`}>{x?.invoiceNumber ?? x?.statement?.number ?? r.filename}</Link>
                    <div className="muted" style={{ fontSize: 12 }}>{r.emailSubject ?? r.filename}</div>
                  </td>
                  <td>{partner ?? <span className="muted">{r.emailFrom ?? "–"}</span>}</td>
                  <td className="num">{total != null ? `${fmtHuf(total)} ${x?.currency && x.currency !== "HUF" ? x.currency : "Ft"}` : x?.statement ? `${x.statement.transactions.length} tétel` : "–"}</td>
                  <td><span className={`badge ${r.status === "booked" ? "posted" : r.status === "review" || r.status === "error" ? "soon" : "draft"}`}>{STATUS_HU[r.status] ?? r.status}</span></td>
                  <td className="muted" style={{ fontSize: 12.5, maxWidth: 320 }}>
                    {r.status === "error" ? r.error : r.proposal?.issues?.slice(0, 2).join(" · ")}
                    {r.invoiceId && <Link href={`/c/${cid}/invoices/${r.invoiceId}`}> → számla</Link>}
                  </td>
                  <td>
                    {canWrite && !["booked", "ignored", "duplicate"].includes(r.status) && (
                      <form action={ignoreDocAction}><input type="hidden" name="cid" value={cid} /><input type="hidden" name="id" value={r.id} /><button className="link">kihagyás</button></form>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={8} className="muted">Nincs ilyen tétel.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
