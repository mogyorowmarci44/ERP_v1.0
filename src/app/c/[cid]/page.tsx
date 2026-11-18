import Link from "next/link";
import { and, count, eq, inArray, max } from "drizzle-orm";
import {
  Inbox, FileOutput, FileInput, FilePlus2, BookPlus, ChartNoAxesCombined, Percent, Clock, CarFront, Files, PiggyBank, Library, Database, Cog, ChevronRight,
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
const eurFmt = new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 0, useGrouping: "always" });

export default async function Dashboard({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const { company } = await requireCompany(cid);
  const t = today();
  if (isPrivate(company)) return <GhOverview cid={cid} profile={company.taxProfile} sp={await searchParams} />;
  const [tb, recv, pay, stock, vat, [inbox], [drafts], [last], money] = await Promise.all([
    trialBalance(cid, yearStart(t), t),
    openItems(cid, "out"),
    openItems(cid, "in"),
    vehicleStock(cid),
    vatAnalytics(cid, monthStart(t), monthEnd(t)),
    db.select({ n: count() }).from(schema.inboxDocuments).where(and(eq(schema.inboxDocuments.companyId, cid), inArray(schema.inboxDocuments.status, INBOX_TODO))),
    db.select({ n: count() }).from(schema.invoices).where(and(eq(schema.invoices.companyId, cid), eq(schema.invoices.status, "draft"))),
    db.select({ at: max(schema.journalEntries.createdAt) }).from(schema.journalEntries).where(eq(schema.journalEntries.companyId, cid)),
    cashSplit(cid, t),
  ]);
  const cv = await companyValue(cid, await valuationParamsFor(cid));
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
  if (drafts.n) todos.push({ icon: <FilePlus2 />, text: `${drafts.n} számla piszkozatban – még nincs lekönyvelve`, href: `${b}/invoices?dir=in`, tag: "Piszkozat" });
  if (recvLate.length) todos.push({ icon: <Clock />, text: `${recvLate.length} lejárt vevőszámla · ${eFt(recvLate.reduce((s, r) => s + toHuf(r), 0))}`, href: `${b}/reports/open-items`, tag: "Lejárt", warn: true });
  if (payLate.length) todos.push({ icon: <Clock />, text: `${payLate.length} lejárt szállítói számla · ${eFt(payLate.reduce((s, r) => s + toHuf(r), 0))}`, href: `${b}/reports/open-items`, tag: "Fizetendő", warn: true });
  todos.push({ icon: <Percent />, text: `Következő ÁFA-bevallás határideje: ${fmtDate(vatDue)}`, href: `${b}/reports/vat`, tag: `${vatDays} nap`, warn: vatDays <= 5 });
  if (stale.length) todos.push({ icon: <CarFront />, text: `${stale.length} gépkocsi több mint ${STALE_DAYS} napja készleten`, href: `${b}/vehicles`, tag: "Figyelj", warn: true });
  // az ÁFA-határidő csak akkor számít teendőnek, ha 5 napon belül van
  const open = todos.length - (vatDays <= 5 ? 0 : 1);

  const tiles: { title: string; icon: React.ReactNode; badge?: string; links: [string, string][] }[] = [
    { title: "Bizonylatok", icon: <Files />, badge: inbox.n ? `${inbox.n} új` : undefined, links: [["Beérkező bizonylatok", `${b}/inbox`], ["Vevőszámlák", `${b}/invoices?dir=out`], ["Szállítói számlák", `${b}/invoices?dir=in`], ["Vegyes / bank tétel", `${b}/journal/new`]] },
    { title: "Pénzügy", icon: <PiggyBank />, links: [["Pénztár és bank", `${b}/money`], ["Tagi kölcsön", `${b}/member-loans`]] },
    { title: "Kimutatások", icon: <ChartNoAxesCombined />, links: [["P&L, cash-flow, mérleg", `${b}/reports/statements`], ["Éves beszámoló", `${b}/reports/annual`], ["Főkönyvi kivonat", `${b}/reports/trial-balance`], ["ÁFA analitika", `${b}/reports/vat`], ["Különbözeti ÁFA kartonok", `${b}/vehicles/kartonok`], ["EPR összesítő", `${b}/vehicles/epr`], ["Nyitott tételek", `${b}/reports/open-items`]] },
    { title: "Főkönyv", icon: <Library />, links: [["Napló", `${b}/journal`], ["Számlakarton", `${b}/reports/ledger`]] },
    { title: "Törzsadatok", icon: <Database />, badge: `${inStock.length} autó`, links: [["Gépkocsi készlet", `${b}/vehicles`], ["Partnerek", `${b}/partners`], ["Számlatükör", `${b}/accounts`], ["Árfolyamok (MNB)", `${b}/fx`]] },
    { title: "Tervezés és rendszer", icon: <Cog />, links: [["Forecast", `${b}/forecast`], ["Megjelenés", `${b}/appearance`], ["Beállítások", `${b}/settings`], ["Adatimport", `${b}/import`]] },
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
      <div className="grid cols-4 lp-kpi">
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
