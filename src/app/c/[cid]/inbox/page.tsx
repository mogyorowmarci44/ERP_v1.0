import Link from "next/link";
import { and, asc, count, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { Pager, pageOf } from "@/components/Pager";
import { db, schema } from "@/db";
import { requireCompany } from "@/lib/auth";
import { Flash } from "@/components/Flash";
import { SubmitButton } from "@/components/SubmitButton";
import { binderPositions, getInboxSettings, type SyncSummary } from "@/lib/inbox/service";
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
  ["paper", "Papír archívum", ["new", "extracted", "review", "booked", "duplicate", "ignored", "error"]],
] as const;
const PAGE = 100;

export default async function InboxPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  const { role } = await requireCompany(cid);
  const canWrite = role !== "viewer";
  const tab = TABS.find((t) => t[0] === sp.tab) ?? TABS[0];
  const paperTab = tab[0] === "paper";
  const { settings, lastSyncAt } = await getInboxSettings(cid);
  // v7.0.0 – keresés és lapozás (korábban 300 / 1000 tételnél csendben levágott)
  const q = (sp.q ?? "").trim();
  const like = `%${q.replace(/[\\%_]/g, (m) => "\\" + m)}%`;
  const D = schema.inboxDocuments;
  const where = and(
    eq(D.companyId, cid), inArray(D.status, [...tab[2]]), paperTab ? isNotNull(D.filingNo) : undefined,
    q ? sql`(${D.filename} ilike ${like} or ${D.emailSubject} ilike ${like} or ${D.emailFrom} ilike ${like} or ${D.filingNo} ilike ${like}
      or ${D.extracted}->>'invoiceNumber' ilike ${like} or ${D.extracted}->'seller'->>'name' ilike ${like} or ${D.extracted}->'buyer'->>'name' ilike ${like})` : undefined,
  );
  const cols = { id: D.id, source: D.source, kind: D.kind, filename: D.filename, status: D.status,
      emailFrom: D.emailFrom, emailSubject: D.emailSubject, emailDate: D.emailDate, createdAt: D.createdAt,
      extracted: D.extracted, proposal: D.proposal, invoiceId: D.invoiceId, error: D.error, filingNo: D.filingNo };
  const [{ n: total }] = await db.select({ n: count() }).from(D).where(where);
  const page = pageOf(sp.page, Number(total), PAGE);
  // papír archívum: a lefűző sorrendje (hónap csökkenő, azon belül a beszkennelés sorrendje) – ehhez az egész kell, a lapozás utána
  const binder = paperTab ? await binderPositions(cid) : null;
  let rows;
  if (binder) {
    const all = await db.select(cols).from(D).where(where).orderBy(desc(D.filingNo), asc(D.id));
    all.sort((a, b) => {
      const A = binder.get(a.id), B = binder.get(b.id);
      return (B?.month ?? "").localeCompare(A?.month ?? "") || (A?.pos ?? 0) - (B?.pos ?? 0);
    });
    rows = all.slice((page - 1) * PAGE, page * PAGE);
  } else {
    rows = await db.select(cols).from(D).where(where).orderBy(desc(D.createdAt), asc(D.id)).limit(PAGE).offset((page - 1) * PAGE);
  }
  const counts = await db.select({ status: D.status, filingNo: D.filingNo }).from(D).where(eq(D.companyId, cid));
  const cnt = (k: string, st: readonly string[]) => counts.filter((c) => st.includes(c.status) && (k !== "paper" || c.filingNo)).length;
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
            {(settings.invoicing ?? []).length > 0 && ` · kiállított számlák: ${(settings.invoicing ?? []).map((l) => (l.provider === "szamlazz" ? "számlázz.hu" : "Billingo")).join(", ")}`}
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
        {TABS.map(([k, label, st]) => <Link key={k} href={`/c/${cid}/inbox?tab=${k}`} className={k === tab[0] ? "on" : undefined}>{label} ({cnt(k, st)})</Link>)}
      </div>

      {paperTab && (
        <p className="muted" style={{ marginTop: -4 }}>
          A papír bizonylatok a havi lefűző sorrendjében: hónaponként úgy, ahogy beszkennelted őket – a papírt is ebben a sorrendben fűzd le, ráírni nem kell semmit. Az iktatószám a digitális példányon szerepel. Az eredeti papírt meg kell őrizni.
        </p>
      )}

      <form className="row no-print" style={{ gap: 8, marginBottom: 10 }}>
        <input type="hidden" name="tab" value={tab[0]} />
        <input name="q" defaultValue={q} placeholder="Keresés: partner, számlaszám, fájlnév, iktatószám, feladó…" style={{ flex: 1, minWidth: 220 }} />
        <button>Keresés</button>
        {q && <Link className="btn" href={`/c/${cid}/inbox?tab=${tab[0]}`}>Szűrés törlése</Link>}
      </form>
      <Pager page={page} size={PAGE} total={Number(total)} query={{ tab: tab[0], q: q || undefined }} />

      <div className="table-wrap">
        <table>
          <thead><tr>{paperTab && <th>Lefűző</th>}<th>Érkezett</th><th>Forrás</th><th>Bizonylat</th><th>Partner</th><th className="num">Összeg</th><th>Állapot</th><th>Megjegyzés</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => {
              const x = r.extracted;
              const partner = x ? (x.direction === "out" ? x.buyer?.name : x.seller?.name) ?? r.proposal?.invoice?.partner.name : null;
              const total = x?.totals?.gross ?? null;
              return (
                <tr key={r.id}>
                  {paperTab && <td className="nowrap">{binder?.get(r.id) ? <><strong>{binder.get(r.id)!.month}</strong> · {binder.get(r.id)!.pos}.</> : "–"}</td>}
                  <td className="nowrap">{fmtDate((r.emailDate ?? r.createdAt).toISOString().slice(0, 10))}</td>
                  <td>{r.source === "gmail" ? "Gmail" : r.source === "drive" ? "Drive" : r.source === "bank" ? "Bank (API)" : r.source === "szamlazz" ? "számlázz.hu" : r.source === "billingo" ? "Billingo" : "feltöltés"}{r.kind === "statement" ? " · kivonat" : ""}</td>
                  <td>
                    {r.filingNo && <span className="badge filing">{r.filingNo}</span>}{" "}
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
            {rows.length === 0 && <tr><td colSpan={paperTab ? 9 : 8} className="muted">{q ? "Nincs találat." : "Nincs ilyen tétel."}</td></tr>}
          </tbody>
        </table>
      </div>
      <Pager page={page} size={PAGE} total={Number(total)} query={{ tab: tab[0], q: q || undefined }} />
    </>
  );
}
