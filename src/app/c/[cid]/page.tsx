import Link from "next/link";
import { and, count, eq, inArray, max, sql } from "drizzle-orm";
import {
  Inbox, FileOutput, FileInput, FilePlus2, BookPlus, ChartNoAxesCombined, Percent, Clock, CarFront, Files, PiggyBank, Library, Database, Cog, ChevronRight, Tag, Scale, Gauge, ListChecks,
} from "lucide-react";
import { db, schema } from "@/db";
import { requireCompany } from "@/lib/auth";
import { trialBalance, openItems, vehicleStock, vatAnalytics } from "@/lib/reports";
import { fmtDate, monthEnd, monthStart, today, yearStart } from "@/lib/dates";
import { isPrivate } from "@/lib/entity";
import { nextVatDeadline } from "@/lib/vat-deadline";
import { GhOverview } from "./gh/Overview";
import { cashSplit } from "@/lib/cash-split";
import { companyValue, valuationParamsFor } from "@/lib/company-value";
import { unclosedVatPeriods } from "@/lib/vat-closing";
import { consistencyCounts } from "@/lib/consistency";
import { dueAccruals } from "@/lib/accruals";
import { operationStartOf } from "@/lib/kpi";
import { salesGap, type GapTone } from "@/lib/sales-gap";
import { draftCounts, draftText } from "@/lib/drafts";

const INBOX_TODO = ["review", "error", "new", "extracted"];
const STALE_DAYS = 90;

/** Dátum és idő (óra:perc) magyar idő szerint, pl. 2026.11.16. 12:24 */
const fmtDateTime = (d: Date) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("hu-HU", { timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(d)).map((x) => [x.type, x.value]));
  return `${p.year}.${p.month}.${p.day}. ${p.hour}:${p.minute}`;
};
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
const toHuf = (r: { currency: string; openFx: number; grossHuf: string | number; grossFx: string | number }) =>
  r.currency === "HUF" ? r.openFx : (r.openFx * Number(r.grossHuf)) / Number(r.grossFx || 1);
/** Ezer forintra kerekítve, „eFt” egységgel. */
const eFtFmt = new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 0, useGrouping: "always" }); // 4 jegyű számot is tagol (8 412)
const eFt = (n: number) => `${eFtFmt.format(Math.round(n / 1000) || 0)} eFt`;
/** A szünet-csempe háttere: zöld (0 nap a legerősebb) · sárga · egyre erősebb piros. */
const gapBg = (t: GapTone) =>
  t.kind === "pos" ? `color-mix(in srgb, var(--pos) ${Math.round(12 + 38 * t.strength)}%, var(--surface))`
  : t.kind === "warn" ? "color-mix(in srgb, #e3b008 34%, var(--surface))"
  : t.kind === "neg" ? `color-mix(in srgb, var(--neg) ${Math.round(16 + 44 * t.strength)}%, var(--surface))`
  : undefined;
const shortDate = (d: string) => d.replaceAll("-", ". ") + ".";
const eurFmt = new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 0, useGrouping: "always" });

export default async function Dashboard({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const { company } = await requireCompany(cid);
  const t = today();
  if (isPrivate(company)) return <GhOverview cid={cid} profile={company.taxProfile} sp={await searchParams} />;
  const [tb, recv, pay, stock, vat, [inbox], drafts, [last], money] = await Promise.all([
    trialBalance(cid, yearStart(t), t),
    openItems(cid, "out"),
    openItems(cid, "in"),
    vehicleStock(cid),
    vatAnalytics(cid, monthStart(t), monthEnd(t)),
    db.select({ n: count() }).from(schema.inboxDocuments).where(and(eq(schema.inboxDocuments.companyId, cid), inArray(schema.inboxDocuments.status, INBOX_TODO))),
    draftCounts(cid),
    db.select({ at: max(schema.journalEntries.createdAt) }).from(schema.journalEntries).where(eq(schema.journalEntries.companyId, cid)),
    cashSplit(cid, t),
  ]);
  const cv = await companyValue(cid, await valuationParamsFor(cid));
  // eladási napok (kiszámlázott gépkocsik teljesítési dátuma) – a számláló a működés kezdetétől indul
  const [saleRows, opStart] = await Promise.all([
    db.execute(sql`select distinct i.fulfillment_date::text d from invoice_lines il join invoices i on i.id = il.invoice_id
      where i.company_id = ${cid} and i.direction = 'out' and i.status = 'posted' and il.vehicle_id is not null`) as unknown as Promise<Array<{ d: string }>>,
    operationStartOf(cid),
  ]);
  const gap = salesGap(saleRows.map((r) => r.d), opStart, t);
  const bal = (pred: (code: string) => boolean) => tb.filter((r) => pred(r.code)).reduce((s, r) => s + r.closingDebit - r.closingCredit, 0);
  const revenue = -bal((c) => c.startsWith("9"));
  const costs = bal((c) => c.startsWith("5") || c.startsWith("8"));
  const result = revenue - costs;
  const inStock = stock.filter((v) => v.status !== "sold");
  const stockValue = inStock.reduce((s, v) => s + v.bookValue, 0);
  const recvHuf = recv.reduce((s, r) => s + toHuf(r), 0);
  const payHuf = pay.reduce((s, r) => s + toHuf(r), 0);
  const recvLate = recv.filter((r) => r.dueDate && r.dueDate < t);
  const payLate = pay.filter((r) => r.dueDate && r.dueDate < t);
  const stale = inStock.filter((v) => v.purchaseDate && daysBetween(v.purchaseDate, t) > STALE_DAYS);
  const vatDue = nextVatDeadline(company.vatPeriod, t);
  const vatDays = daysBetween(t, vatDue);
  const b = `/c/${cid}`;

  type Todo = { icon: React.ReactNode; text: string; href: string; tag: string; warn?: boolean };
  const todos: Todo[] = [];
  if (inbox.n) todos.push({ icon: <Inbox />, text: `${inbox.n} beérkező bizonylat könyvelésre vár`, href: `${b}/inbox`, tag: "Megnyitás" });
  if (drafts.total) todos.push({ icon: <FilePlus2 />, text: draftText(drafts), href: drafts.href, tag: "Piszkozat" });
  if (recvLate.length) todos.push({ icon: <Clock />, text: `${recvLate.length} lejárt vevőszámla · ${eFt(recvLate.reduce((s, r) => s + toHuf(r), 0))}`, href: `${b}/reports/open-items`, tag: "Lejárt", warn: true });
  if (payLate.length) todos.push({ icon: <Clock />, text: `${payLate.length} lejárt szállítói számla · ${eFt(payLate.reduce((s, r) => s + toHuf(r), 0))}`, href: `${b}/reports/open-items`, tag: "Fizetendő", warn: true });
  todos.push({ icon: <Percent />, text: `Következő ÁFA-bevallás határideje: ${fmtDate(vatDue)}`, href: `${b}/reports/vat`, tag: `${vatDays} nap`, warn: vatDays <= 5 });
  const [vatOpen, accDue, cons] = await Promise.all([unclosedVatPeriods(cid), dueAccruals(cid), consistencyCounts(cid).catch(() => ({ errors: 0, warnings: 0 }))]);
  if (cons.errors || cons.warnings) todos.push({ icon: <ListChecks />, text: cons.errors ? `${cons.errors} egyezőségi hiba a könyvelésben` : `${cons.warnings} egyezőségi figyelmeztetés`, href: `${b}/reports/consistency`, tag: "Egyezőség", warn: true });
  if (vatOpen.length) todos.push({ icon: <Percent />, text: `${vatOpen.length} lejárt ÁFA-időszak nincs lezárva (466 / 467 → 468)`, href: `${b}/reports/vat/closing?year=${vatOpen[0].to.slice(0, 4)}`, tag: "ÁFA-zárás", warn: true });
  if (accDue.length) todos.push({ icon: <Clock />, text: `${accDue.length} időbeli elhatárolás feloldásra vár · ${eFt(accDue.reduce((s, a) => s + a.amount, 0))}`, href: `${b}/closing/accruals`, tag: "Elhatárolás", warn: true });
  if (stale.length) todos.push({ icon: <CarFront />, text: `${stale.length} gépkocsi több mint ${STALE_DAYS} napja készleten`, href: `${b}/vehicles/merleg`, tag: "Figyelj", warn: true });
  // az ÁFA-határidő csak akkor számít teendőnek, ha 5 napon belül van
  const open = todos.length - (vatDays <= 5 ? 0 : 1);

  const tiles: { title: string; icon: React.ReactNode; badge?: string; links: [string, string][] }[] = [
    { title: "Bizonylatok", icon: <Files />, badge: inbox.n ? `${inbox.n} új` : undefined, links: [["Beérkező bizonylatok", `${b}/inbox`], ["Vevőszámlák", `${b}/invoices?dir=out`], ["Szállítói számlák", `${b}/invoices?dir=in`], ["Vegyes / bank tétel", `${b}/journal/new`]] },
    { title: "Pénzügy", icon: <PiggyBank />, links: [["Pénztár és bank", `${b}/money`], ["Tagi kölcsön", `${b}/member-loans`], ["Bérszámfejtés", `${b}/payroll`]] },
    { title: "Kimutatások", icon: <ChartNoAxesCombined />, links: [["KPI-Dashboard", `${b}/reports/kpi`], ["P&L, cash-flow, mérleg", `${b}/reports/statements`], ["ÁFA", `${b}/reports/vat`], ["KészletMérleg", `${b}/vehicles/merleg`], ["EPR összesítő", `${b}/vehicles/epr`], ["Nyitott tételek", `${b}/reports/open-items`], ["Egyezőség", `${b}/reports/consistency`]] },
    { title: "Főkönyv", icon: <Library />, links: [["Napló", `${b}/journal`], ["Számlakarton", `${b}/reports/ledger`], ["Tárgyi eszközök", `${b}/assets`], ["Évzárás", `${b}/closing`]] },
    { title: "Törzsadatok", icon: <Database />, badge: `${inStock.length} autó`, links: [["Gépkocsi készlet", `${b}/vehicles`], ["KészletMérleg", `${b}/vehicles/merleg`], ["Partnerek", `${b}/partners`], ["Számlatükör", `${b}/accounts`], ["Árfolyamok (MNB)", `${b}/fx`]] },
    { title: "Tervezés és rendszer", icon: <Cog />, links: [["Forecast", `${b}/forecast`], ["ÁrSugó", `${b}/arsugo`], ["Megjelenés", `${b}/appearance`], ["Beállítások", `${b}/settings`], ["Adatimport / export", `${b}/import`]] },
  ];

  return (
    <div className="landing">
      <div className="topbar">
        <div>
          <h1>{open ? `${open} dolog vár rád` : "Minden rendben"}</h1>
          <span className="muted">{company.name} · {fmtDate(t)} · Utolsó könyvelés: {last?.at ? fmtDateTime(last.at) : "még nincs"}</span>
        </div>
        <Link className="btn" href={`${b}/reports/statements?type=pnl&gran=month`}>Havi eredménykimutatás</Link>
      </div>

      <div className="lp-top">
        <div className="card lp-todo">
          {todos.map((x, i) => (
            <Link key={i} href={x.href} className="lp-row">
              {x.icon}<span>{x.text}</span><span className={x.warn ? "lp-tag warn" : "lp-tag"}>{x.tag}</span>
            </Link>
          ))}
        </div>
        <div className="lp-actions">
          <Link className="btn primary" href={`${b}/invoices/new?dir=out`}><FileOutput />Új vevőszámla</Link>
          <Link className="btn" href={`${b}/invoices/new?dir=in`}><FileInput />Új szállítói számla</Link>
          <Link className="btn" href={`${b}/journal/new`}><BookPlus />Vegyes / bank tétel</Link>
          <Link className="btn" href={`${b}/vehicles`}><CarFront />Gépkocsi készlet</Link>
          <Link className="btn" href={`${b}/vehicles/merleg`}><Scale />KészletMérleg</Link>
          <Link className="btn" href={`${b}/arsugo`}><Tag />ÁrSugó</Link>
          {inStock.length > 0 && (
            <form action={`${b}/vehicles/automerleg`} className="lp-automerleg">
              <label className="sr-only" htmlFor="lp-am-car">Autó</label>
              <select id="lp-am-car" name="vehicle" defaultValue="">
                <option value="" disabled>Autó kiválasztása…</option>
                {inStock.map((v) => <option key={v.id} value={v.id}>{v.make} {v.model}{v.plate ? ` (${v.plate})` : ""}</option>)}
              </select>
              <button className="btn"><Gauge />AutóMérleg</button>
            </form>
          )}
        </div>
      </div>

      <div className="grid cols-4 lp-kpi">
        {money.map((m) => (
          <Link key={m.key} href={`${b}/money`} className="card stat primary lp-money" title={m.accounts.length ? `Számlák: ${m.accounts.join(", ")}` : "Nincs ilyen pénzeszköz-számla"}>
            <div className="label">{m.label}</div>
            {m.fx === null
              ? <div className={m.huf < 0 ? "value neg" : "value"}>{eFt(m.huf)}</div>
              : <div className={m.fx < 0 ? "value neg" : "value"}>{eurFmt.format(m.fx)} €<small>{eFt(m.huf)}</small></div>}
          </Link>
        ))}
      </div>
      <div className="grid lp-kpi lp-kpi5">
        <Link href={`${b}/reports/kpi`} className="card stat lp-gap" style={{ background: gapBg(gap.tone) }}
          title={gap.median != null ? `Medián szünet két eladás között: ${Math.round(gap.median)} nap (${gap.gapCount} szünet alapján)` : "Még nincs elég eladás a mediánhoz"}>
          <div className="label">Előző eladás óta</div>
          <div className="value">{gap.daysSince == null ? "–" : <>{gap.daysSince} nap{gap.median != null && <small>medián {Math.round(gap.median)} nap</small>}</>}</div>
          {gap.worst && gap.daysSince != null && (
            <div className="lp-gap-sub" title={`${shortDate(gap.worst.from)} – ${gap.worst.ongoing ? "ma" : shortDate(gap.worst.to)}`}>
              {gap.worst.ongoing
                ? `Eddigi legrosszabb: ${gap.worst.days} nap, ez most az új rekord`
                : `Eddigi legrosszabb: ${gap.worst.days} nap, most ${gap.worst.days - gap.daysSince} nappal alatta vagy`}
            </div>
          )}
        </Link>
        <Link href={`${b}/value`} className="card stat lp-value" title="Korrigált nettó eszközérték – kattints a három számításért">
          <div className="label">Cégérték</div>
          <div className={cv.nav.value < 0 ? "value neg" : "value"}>{eFt(cv.nav.value)}</div>
        </Link>
        <div className="card stat"><div className="label">Készlet ({inStock.length} db)</div><div className="value">{eFt(stockValue)}</div></div>
        <div className="card stat"><div className="label">Eredmény (év, adózás előtt)</div><div className={result < 0 ? "value neg" : "value"}>{eFt(result)}</div></div>
        <div className="card stat"><div className="label">ÁFA egyenleg (tárgyhó)</div><div className="value">{eFt(vat.balance)}</div></div>
      </div>
      <p className="muted lp-sub">Nyitott vevők: {eFt(recvHuf)} · Nyitott szállítók: {eFt(payHuf)} · Bevétel (év): {eFt(revenue)} · Költség (év): {eFt(costs)}</p>

      <div className="lp-tiles">
        {tiles.map((x) => (
          <div key={x.title} className="card lp-tile">
            <h3>{x.icon}{x.title}{x.badge && <span className="lp-tag">{x.badge}</span>}</h3>
            {x.links.map(([label, href]) => <Link key={href} href={href}>{label}<ChevronRight /></Link>)}
          </div>
        ))}
      </div>
    </div>
  );
}
