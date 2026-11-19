"use client";

import { useState } from "react";
import { monthDays } from "@/lib/workcal";
import { DAY_CODES, effectiveCode, isEfo, type Attendance, type DayCode, type Employment, type PayrollInput } from "@/lib/payroll-calc";

const DOW = ["H", "K", "Sze", "Cs", "P", "Szo", "V"];

/**
 * Jelenléti naptár egy jogviszony egy hónapjára: a választott kóddal („ecset”) kattintva lehet napokat jelölni.
 * Üres nap = munkarend szerinti alapérték (munkanapon „munkában”, EFO-nál „nem dolgozott”).
 */
export function AttendanceCalendar({ employment, period, days, attendance, locked, onChange }: {
  employment: Employment; period: string; days: PayrollInput["days"]; attendance: Attendance | null; locked: boolean;
  onChange: (days: NonNullable<PayrollInput["days"]>) => void;
}) {
  const efo = isEfo(employment.kind);
  const [brush, setBrush] = useState<DayCode | "">(efo ? "M" : "SZ");
  const cal = monthDays(period);
  const cur = days ?? {};

  const paint = (day: number) => {
    if (locked) return;
    const d = cal[day - 1];
    const next = { ...cur };
    const def = effectiveCode(employment, d, undefined);
    // ugyanazzal a kóddal újra kattintva visszaáll az alapértékre
    if (!brush || cur[String(day)] === brush || (!cur[String(day)] && def === brush)) delete next[String(day)];
    else next[String(day)] = brush;
    onChange(next);
  };
  const fillWorkdays = () => {
    const inJob = (date: string) => date >= employment.startDate && (!employment.endDate || date <= employment.endDate);
    const next: NonNullable<PayrollInput["days"]> = {};
    for (const d of cal) if (d.type === "work" && inJob(d.date)) next[String(d.day)] = "M";
    onChange(next);
  };

  const a = attendance;
  return (
    <div className="att">
      <div className="att-tools">
        {!locked && (
          <>
            <span className="muted small">Jelölés:</span>
            {DAY_CODES.filter((c) => !efo || c.code === "M").map((c) => (
              <button key={c.code} type="button" className={`att-brush att-${c.code}${brush === c.code ? " on" : ""}`} title={c.hint} onClick={() => setBrush(c.code)}>
                {c.code} <span>{c.label}</span>
              </button>
            ))}
            <button type="button" className={`att-brush${brush === "" ? " on" : ""}`} title="A nap visszaállítása a munkarend szerinti alapértékre" onClick={() => setBrush("")}>✕ <span>Alapérték</span></button>
            {efo && <button type="button" className="small" onClick={fillWorkdays}>Minden munkanap</button>}
            {Object.keys(cur).length > 0 && <button type="button" className="small link" onClick={() => onChange({})}>Naptár törlése</button>}
          </>
        )}
      </div>
      <div className="att-strip" style={{ gridTemplateColumns: `repeat(${cal.length}, minmax(26px, 1fr))` }}>
        {cal.map((d) => {
          const code = effectiveCode(employment, d, cur);
          const out = d.date < employment.startDate || (!!employment.endDate && d.date > employment.endDate);
          const explicit = !!cur[String(d.day)];
          return (
            <button
              key={d.day} type="button" disabled={locked || out}
              className={`att-day t-${d.type}${out ? " out" : ""}${code ? ` att-${code}` : ""}${explicit ? " set" : ""}`}
              title={`${d.date} ${DOW[d.dow]}${d.label ? ` – ${d.label}` : ""}${code ? ` · ${DAY_CODES.find((c) => c.code === code)?.label}` : ""}`}
              onClick={() => paint(d.day)}
            >
              <span className="n">{d.day}</span>
              <span className="w">{DOW[d.dow]}</span>
              <span className="c">{code ?? (d.type === "holiday" ? "Ü" : "")}</span>
            </button>
          );
        })}
      </div>
      <div className="att-sum small">
        {a ? (
          efo ? <span><strong>{a.efoDays}</strong> alkalmi munkanap</span> : (
            <>
              <span>{a.workdays} munkanap</span>
              <span>dolgozott <strong>{a.worked}</strong></span>
              {a.leave > 0 && <span className="att-SZ">szabadság {a.leave}</span>}
              {a.sick > 0 && <span className="att-B">betegszabadság {a.sick}</span>}
              {a.unpaid > 0 && <span className="att-T">táppénz / fizetetlen {a.unpaid}</span>}
              {a.idle > 0 && <span>nem beosztott {a.idle}</span>}
              {a.restWorked + a.holidayWorked > 0 && <span className="att-M">pihenő- / ünnepnapon dolgozott {a.restWorked + a.holidayWorked} (100% pótlék)</span>}
            </>
          )
        ) : <span className="muted">Nincs jelölés – {efo ? "az alkalmi napok száma kézzel van megadva." : "minden munkanap ledolgozottnak számít."}</span>}
        <span className="muted">· Szombat / vasárnap és munkaszüneti nap szürke; „Ü” = munkaszüneti nap.</span>
      </div>
    </div>
  );
}
