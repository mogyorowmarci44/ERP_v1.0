/**
 * v6.4.0 – Központi jogszabályi paraméterek dátum szerinti hatállyal (tiszta függvények).
 *
 * Minden paraméternek van beépített története (a kódban), amelyet az üzemeltető az *Admin › Jogszabályi paraméterek*
 * oldalon új, dátumtól hatályos értékkel egészíthet ki vagy írhat felül – ez minden ügyfélnél azonnal érvényes.
 * Egy adott napra a legkésőbbi, addig hatályba lépett érték érvényes (azonos dátumnál az üzemeltetői érték nyer).
 */
import { DEFAULT_PARAMS, PARAM_LABELS, type PayrollParams } from "./payroll-calc";

export type ParamValue = number;
export type ParamPoint = { from: string; value: ParamValue; note?: string | null; source: "builtin" | "operator" };
export type ParamDef = { key: string; label: string; unit: string; group: string; builtin: { from: string; value: ParamValue; note?: string }[] };

const PAYROLL_KEYS = PARAM_LABELS.filter((p) => p.key !== "memberTbAccount");

export const LEGAL_PARAMS: ParamDef[] = [
  {
    key: "tax.tao", label: "Társasági adó kulcsa", unit: "%", group: "Adók",
    builtin: [{ from: "2017-01-01", value: 9, note: "Tao. tv. 19. § (1)" }],
  },
  ...PAYROLL_KEYS.map((p): ParamDef => ({
    key: `payroll.${p.key}`, label: p.label, unit: p.unit, group: "Bér és járulékok",
    builtin: Object.entries(DEFAULT_PARAMS).map(([y, v]) => ({ from: `${y}-01-01`, value: Number(v[p.key]) })),
  })),
];

export const paramDef = (key: string) => LEGAL_PARAMS.find((p) => p.key === key);

/** A paraméter teljes története (beépített + üzemeltetői), hatálybalépés szerint. */
export function history(key: string, operator: { key: string; validFrom: string; value: unknown; note?: string | null }[]): ParamPoint[] {
  const def = paramDef(key);
  const pts = new Map<string, ParamPoint>();
  for (const b of def?.builtin ?? []) pts.set(b.from, { from: b.from, value: b.value, note: b.note ?? null, source: "builtin" });
  for (const o of operator.filter((x) => x.key === key)) pts.set(o.validFrom, { from: o.validFrom, value: Number(o.value), note: o.note ?? null, source: "operator" });
  return [...pts.values()].sort((a, b) => a.from.localeCompare(b.from));
}

/** Az adott napon hatályos érték (ha a legkorábbi hatálybalépés előtti a nap, a legkorábbi érték). */
export function resolveAt(pts: ParamPoint[], date: string): ParamPoint | null {
  if (!pts.length) return null;
  return [...pts].reverse().find((p) => p.from <= date) ?? pts[0];
}

/** A bérparaméterek egy napra (a költségszámla – memberTbAccount – nem jogszabályi adat, azt a hívó adja). */
export function payrollParamsAt(date: string, operator: Parameters<typeof history>[1], memberTbAccount = "551"): PayrollParams {
  const out: Record<string, number | string> = { memberTbAccount };
  for (const p of PAYROLL_KEYS) out[p.key] = resolveAt(history(`payroll.${p.key}`, operator), date)?.value ?? 0;
  return out as unknown as PayrollParams;
}
