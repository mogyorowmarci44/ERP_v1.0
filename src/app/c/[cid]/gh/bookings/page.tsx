/** v2.0 – Foglalások: naptár, lista, közvetlen foglalás rögzítése. */
import { notFound } from "next/navigation";
import { and, eq, like, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCompany } from "@/lib/auth";
import { isPrivate } from "@/lib/entity";
import { fmtDate } from "@/lib/dates";
import { fmtHuf } from "@/lib/money";
import { loadGuesthouse, withReservations, type Stay } from "@/lib/guesthouse";
import { addDays, daysBetween, daysInMonth, kpis, sumRange } from "@/lib/gh-calc";
import { accommodationStart, availableDays, fmtNum, fmtPct } from "@/lib/gh-view";
import { Flash } from "@/components/Flash";
import { ScopeNav } from "@/components/gh/GhUi";
import { addDirectBookingAction, ghReverseAction } from "../actions";

const CH_LABEL: Record<Stay["channel"], string> = { airbnb: "Airbnb", booking: "Booking.com", direct: "Közvetlen" };
const MONTHS = ["Január", "Február", "Március", "Április", "Május", "Június", "Július", "Augusztus", "Szeptember", "Október", "November", "December"];

export default async function BookingsPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  const { company } = await requireCompany(cid);
  if (!isPrivate(company)) notFound();
  const d = await loadGuesthouse(cid, company.taxProfile);
  const y1 = Number(d.asOf.slice(0, 4));
  const y0 = Number(d.first.slice(0, 4));
  const year = /^\d{4}$/.test(sp.year ?? "") ? Math.min(y1 + 1, Math.max(y0, Number(sp.year))) : y1;
  const all = await withReservations(cid, d.stays);
  const stays = all.filter((s) => s.from.slice(0, 4) === String(year) || s.to.slice(0, 4) === String(year));
  const start = accommodationStart(d.days);
  const k = kpis(sumRange(d.days, `${year}-01-01`, `${year}-12-31`), availableDays(`${year}-01-01`, `${year}-12-31`, start, d.asOf), d.include);

  // naptár: pontos (dátumos) foglalások éjszakái
  const occ = new Map<string, Stay>();
  for (const s of stays) for (let i = 0; i < s.nights; i++) occ.set(addDays(s.from, i), s);
  const withLead = stays.filter((s) => s.bookedOn);
  const lead = withLead.length ? withLead.reduce((a, s) => a + daysBetween(s.bookedOn!, s.from), 0) / withLead.length : null;
  const upcoming = all.filter((s) => s.to > d.asOf).sort((a, b) => (a.from < b.from ? -1 : 1));

  // rögzített közvetlen foglalások (sztornózhatók)
  const manual = await db
    .select({ id: schema.journalEntries.id, date: schema.journalEntries.date, description: schema.journalEntries.description })
    .from(schema.journalEntries)
    .where(and(eq(schema.journalEntries.companyId, cid), eq(schema.journalEntries.sourceType, "manual"), like(schema.journalEntries.description, "Szállásdíj – %[KZ-%"), sql`${schema.journalEntries.reversedById} is null`, sql`${schema.journalEntries.reversalOfId} is null`));
  const manualByCode = new Map(manual.map((m) => [m.description.match(/\[(KZ-[^\]]+)\]/)?.[1] ?? "", m.id]));

  const moneyAccs = await db
    .select({ code: schema.accounts.code, name: schema.accounts.name })
    .from(schema.accounts)
    .where(and(eq(schema.accounts.companyId, cid), like(schema.accounts.code, "38%"), eq(schema.accounts.isPosting, true), eq(schema.accounts.isActive, true)));
  const banks = moneyAccs.filter((a) => !a.code.startsWith("389")).sort((a, b) => (a.code === "384" ? -1 : b.code === "384" ? 1 : a.code.localeCompare(b.code)));

  const href = (y: number) => `/c/${cid}/gh/bookings?year=${y}`;
  return (
    <div className="gh">
      <Flash error={sp.error} ok={sp.ok} />
      <div className="topbar">
        <h1>Foglalások</h1>
        <ScopeNav prev={year > y0 ? href(year - 1) : null} next={year <= y1 ? href(year + 1) : null} label={String(year)} />
      </div>

      <div className="grid cols-4">
        <div className="card kpi"><div className="label">Eladott éjszakák</div><div className="value">{fmtNum(k.nights, k.nightsEstimated ? 1 : 0)}<small>éj</small></div><div className="hint">kihasználtság {fmtPct(k.occupancy)}{k.nightsEstimated ? ` · ebből becsült ${fmtNum(k.nightsEstimated, 1)}` : ""}</div></div>
        <div className="card kpi"><div className="label">Dátumos foglalások</div><div className="value">{stays.length}<small>db</small></div><div className="hint">átlagosan {stays.length ? fmtNum(stays.reduce((a, s) => a + s.nights, 0) / stays.length, 1) : "–"} éj / foglalás</div></div>
        <div className="card kpi"><div className="label">Foglalási előidő (Airbnb)</div><div className="value">{lead !== null ? fmtNum(lead, 0) : "–"}<small>nap</small></div><div className="hint">a foglalás és az érkezés között átlagosan</div></div>
        <div className="card kpi"><div className="label">Jövőbeli foglalások</div><div className="value">{upcoming.length}<small>db</small></div><div className="hint">{upcoming.length ? `${upcoming.reduce((a, s) => a + s.nights, 0)} éj · ${fmtHuf(upcoming.reduce((a, s) => a + s.amount, 0))} Ft várható` : "nincs rögzítve"}</div></div>
      </div>

      {upcoming.length ? (
        <>
          <h2>Következő foglalások</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Érkezés</th><th>Távozás</th><th className="num">Éj</th><th>Vendég</th><th className="num">Fő</th><th>Csatorna</th><th className="num">Várható összeg</th><th className="num">Ft / éj</th><th>Foglalva</th><th>Megjegyzés</th></tr></thead>
              <tbody>
                {upcoming.map((s) => (
                  <tr key={s.code}>
                    <td>{fmtDate(s.from)}</td><td>{fmtDate(s.to)}</td><td className="num">{s.nights}</td><td>{s.guest ?? ""}</td><td className="num">{s.guests ?? ""}</td>
                    <td><span className="legend"><span><i style={{ background: `var(--ch-${s.channel})` }} />{CH_LABEL[s.channel]}</span></span></td>
                    <td className="num">{s.amount ? fmtHuf(s.amount) : "–"}</td><td className="num">{s.amount ? fmtHuf(s.amount / s.nights) : "–"}</td>
                    <td>{s.bookedOn ? fmtDate(s.bookedOn) : ""}</td><td className="muted" style={{ fontSize: 12.5 }}>{s.note ?? (s.planned ? "" : "már könyvelve")}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={2}>Összesen</td><td className="num">{upcoming.reduce((a, s) => a + s.nights, 0)}</td><td colSpan={3}></td><td className="num">{fmtHuf(upcoming.reduce((a, s) => a + s.amount, 0))}</td><td colSpan={3}></td></tr></tfoot>
            </table>
          </div>
        </>
      ) : null}

      <h2 id="new">Új közvetlen foglalás</h2>
      <form action={addDirectBookingAction} className="card">
        <input type="hidden" name="cid" value={cid} />
        <div className="form-grid">
          <label>Érkezés<input type="date" name="from" required /></label>
          <label>Távozás<input type="date" name="to" required /></label>
          <label>Vendég neve<input name="guest" placeholder="pl. Kiss Anna" /></label>
          <label>Szállásdíj összesen (Ft)<input name="amount" className="num" inputMode="numeric" required placeholder="48 000" /></label>
          <label>Fizetés
            <select name="pay" defaultValue={banks[0]?.code ?? "4192"}>
              {banks.map((b) => <option key={b.code} value={b.code}>Átutalás – {b.name}</option>)}
              <option value="4192">Készpénz / magánzsebbe</option>
            </select>
          </label>
        </div>
        <div className="row" style={{ marginTop: 12 }}><button className="primary">Foglalás rögzítése</button><span className="muted" style={{ fontSize: 12.5 }}>Szállásdíj-bevételként (913) könyveljük az érkezés napjára; a kimutatások az éjszakákra osztják.</span></div>
      </form>

      <h2>Naptár</h2>
      <div className="legend" style={{ marginBottom: 10 }}>
        <span><i style={{ background: "var(--ch-airbnb)" }} />Airbnb</span>
        <span><i style={{ background: "var(--ch-booking)" }} />Booking.com</span>
        <span><i style={{ background: "var(--ch-direct)" }} />Közvetlen</span>
        <span className="muted">· a havi összesítőként rögzített (dátum nélküli) foglalások nem látszanak a naptárban</span>
      </div>
      <div className="card cal">
        {MONTHS.map((name, mi) => {
          const days = daysInMonth(year, mi + 1);
          const lead0 = (new Date(Date.UTC(year, mi, 1)).getUTCDay() + 6) % 7;
          return (
            <div className="m" key={name}>
              <h3>{name}</h3>
              <div className="days">
                {Array.from({ length: lead0 }, (_, i) => <span key={`b${i}`} className="blank" />)}
                {Array.from({ length: days }, (_, i) => {
                  const date = `${year}-${String(mi + 1).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`;
                  const s = occ.get(date);
                  return (
                    <span key={date} className={`${s ? s.channel : ""}${date === d.asOf ? " today" : ""}`} title={s ? `${CH_LABEL[s.channel]}: ${s.guest ?? ""} (${fmtDate(s.from)}–${fmtDate(s.to)}, ${s.nights} éj)` : date}>{i + 1}</span>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <h2>Foglalások ({year})</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Érkezés</th><th>Távozás</th><th className="num">Éj</th><th>Vendég</th><th>Csatorna</th><th className="num">Összeg</th><th className="num">Ft / éj</th><th>Foglalva</th><th className="num">Előidő</th><th></th></tr>
          </thead>
          <tbody>
            {stays.map((s) => {
              const mid = manualByCode.get(s.code);
              return (
                <tr key={s.code}>
                  <td>{fmtDate(s.from)}</td>
                  <td>{fmtDate(s.to)}</td>
                  <td className="num">{s.nights}</td>
                  <td>{s.guest ?? ""}{s.planned ? <span className="muted"> · még nem könyvelt</span> : null}</td>
                  <td><span className="legend"><span><i style={{ background: `var(--ch-${s.channel})` }} />{CH_LABEL[s.channel]}</span></span></td>
                  <td className="num">{fmtHuf(s.amount)}</td>
                  <td className="num">{fmtHuf(s.amount / s.nights)}</td>
                  <td>{s.bookedOn ? fmtDate(s.bookedOn) : ""}</td>
                  <td className="num">{s.bookedOn ? `${daysBetween(s.bookedOn, s.from)} nap` : ""}</td>
                  <td>
                    {mid ? (
                      <form action={ghReverseAction}>
                        <input type="hidden" name="cid" value={cid} />
                        <input type="hidden" name="page" value="bookings" />
                        <input type="hidden" name="entryId" value={mid} />
                        <button className="danger" style={{ padding: "3px 8px", fontSize: 12 }}>Törlés</button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              );
            })}
            {stays.length === 0 && <tr><td colSpan={10} className="muted">Ebben az évben nincs dátumos foglalás.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
