/**
 * v2.2 – Bérszámfejtés: dolgozók, jogviszonyok, havi bértábla, könyvelés.
 * A számítás a payroll-calc.ts-ben (tiszta függvény, a kliens is ugyanazt futtatja).
 *
 * Könyvelés hónaponként egy VN tétel a hónap utolsó napjával, személyenkénti sorokkal:
 *   bruttó bér (EFO is)            T 541 / K 471
 *   SZJA, TB-járulék (levonás)     T 471 / K 462, 463
 *   szocho, EFO közteher           T 561 / K 463
 *   társas vállalkozó min. járulék T 551* / K 463   (*paraméter)
 *   béren kívüli juttatás          T 551 / K 471, közterhe T 551 / K 462 és T 561 / K 463
 * A kifizetés (T 471 / K 38x) és az adók befizetése (T 462, 463 / K 38x) a bank-/pénztártételekkel megy.
 */
import { and, asc, eq, inArray, like } from "drizzle-orm";
import { db, schema } from "@/db";
import { accountIdByCode, postEntry, reverseEntry } from "./ledger";
import { today } from "./dates";
import {
  calcPayroll, defaultParams, isEfo, prorateOf, sumResults,
  type Employment, type EmploymentKind, type PayrollInput, type PayrollParams, type PayrollResult, type YearToDate,
} from "./payroll-calc";

const s = schema;
const daysIn = (p: string) => { const [y, m] = p.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
export const periodEnd = (p: string) => `${p}-${String(daysIn(p)).padStart(2, "0")}`;

export async function getParams(year: number): Promise<PayrollParams> {
  const [row] = await db.select().from(s.payrollParams).where(eq(s.payrollParams.year, year));
  return { ...defaultParams(year), ...(row?.values ?? {}) } as PayrollParams;
}
export async function saveParams(year: number, values: PayrollParams) {
  await db.insert(s.payrollParams).values({ year, values }).onConflictDoUpdate({ target: s.payrollParams.year, set: { values, updatedAt: new Date() } });
}
export async function customizedYears() {
  return (await db.select({ year: s.payrollParams.year }).from(s.payrollParams)).map((r) => r.year);
}

// --- dolgozók és jogviszonyok ------------------------------------------------------------------

export async function listPeople(companyId: number) {
  const [people, emps] = await Promise.all([
    db.select().from(s.employees).where(eq(s.employees.companyId, companyId)).orderBy(asc(s.employees.name)),
    db.select().from(s.employments).where(eq(s.employments.companyId, companyId)).orderBy(asc(s.employments.startDate)),
  ]);
  return people.map((p) => ({ ...p, employments: emps.filter((e) => e.employeeId === p.id) }));
}

export const toEmployment = (e: typeof s.employments.$inferSelect): Employment => ({
  kind: e.kind as EmploymentKind, monthlyWage: Number(e.monthlyWage), dailyWage: Number(e.dailyWage), weeklyHours: e.weeklyHours,
  guaranteedMin: e.guaranteedMin, startDate: e.startDate, endDate: e.endDate,
});

// --- havi bértábla -------------------------------------------------------------------------------

export type MonthRow = {
  employmentId: number; employeeId: number; name: string; position: string | null; employment: Employment;
  input: PayrollInput; ytd: YearToDate; result: PayrollResult;
};

/** Egy hónap bértáblája: a hónapban élő jogviszonyok, a mentett bevitel, az éves halmozott adatok és az eredmény. */
export async function loadMonth(companyId: number, period: string) {
  const year = Number(period.slice(0, 4));
  const first = `${period}-01`, last = periodEnd(period);
  const [params, people, runs] = await Promise.all([
    getParams(year),
    listPeople(companyId),
    db.select().from(s.payrollRuns).where(and(eq(s.payrollRuns.companyId, companyId), like(s.payrollRuns.period, `${year}-%`))),
  ]);
  const run = runs.find((r) => r.period === period) ?? null;
  const items = runs.length ? await db.select().from(s.payrollItems).where(inArray(s.payrollItems.runId, runs.map((r) => r.id))) : [];
  const earlier = new Set(runs.filter((r) => r.period < period).map((r) => r.id));
  const rows: MonthRow[] = [];
  for (const p of people) {
    for (const e of p.employments) {
      if (e.startDate > last || (e.endDate && e.endDate < first)) continue;
      const emp = toEmployment(e);
      const mine = run ? items.find((i) => i.runId === run.id && i.employmentId === e.id) : undefined;
      const input = (mine?.input ?? {}) as PayrollInput;
      const prev = items.filter((i) => earlier.has(i.runId) && i.employmentId === e.id).map((i) => i.input as PayrollInput);
      const ytd: YearToDate = {
        szepUsed: prev.reduce((a, x) => a + (x.benefits ?? []).filter((b) => b.kind === "szep").reduce((q, b) => q + Number(b.amount || 0), 0), 0),
        efoDays: prev.reduce((a, x) => a + Number(x.efoDays ?? 0), 0),
        overtimeHours: prev.reduce((a, x) => a + Number(x.otHours50 ?? 0) + Number(x.otHours100 ?? 0), 0),
      };
      // ugyanannak a személynek a többi jogviszonya is számít a SZÉP-keretbe
      rows.push({ employmentId: e.id, employeeId: p.id, name: p.name, position: p.position, employment: emp, input, ytd, result: calcPayroll(emp, input, params, period, ytd) });
    }
  }
  return { period, params, run, rows, totals: sumResults(rows.map((r) => r.result)) };
}

async function ensureRun(companyId: number, period: string) {
  const [r] = await db.select().from(s.payrollRuns).where(and(eq(s.payrollRuns.companyId, companyId), eq(s.payrollRuns.period, period)));
  if (r) return r;
  const [ins] = await db.insert(s.payrollRuns).values({ companyId, period }).returning();
  return ins;
}

export async function saveMonth(companyId: number, period: string, inputs: Record<number, PayrollInput>) {
  const run = await ensureRun(companyId, period);
  if (run.status === "posted") throw new Error("A hónap már könyvelve van – előbb vond vissza a könyvelést.");
  const ids = Object.keys(inputs).map(Number);
  const owned = ids.length ? await db.select({ id: s.employments.id }).from(s.employments).where(and(eq(s.employments.companyId, companyId), inArray(s.employments.id, ids))) : [];
  for (const { id } of owned) {
    const input = sanitize(inputs[id]);
    await db.insert(s.payrollItems).values({ runId: run.id, employmentId: id, input }).onConflictDoUpdate({ target: [s.payrollItems.runId, s.payrollItems.employmentId], set: { input } });
  }
}

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0; };
function sanitize(x: PayrollInput | undefined): PayrollInput {
  return {
    otHours50: num(x?.otHours50), otHours100: num(x?.otHours100), bonus: num(x?.bonus), efoDays: Math.round(num(x?.efoDays)),
    benefits: (x?.benefits ?? []).filter((b) => num(b.amount) > 0 && ["szep", "ejm", "taxfree"].includes(b.kind)).map((b) => ({ kind: b.kind, amount: num(b.amount), note: b.note?.slice(0, 100) })),
  };
}

/** Könyvelés: egy VN tétel a hónap utolsó napjával. */
export async function postMonth(companyId: number, period: string, userId?: number) {
  const m = await loadMonth(companyId, period);
  if (!m.rows.length) throw new Error("Ebben a hónapban nincs élő jogviszony.");
  if (m.run?.status === "posted") throw new Error("A hónap már könyvelve van.");
  const run = m.run ?? (await ensureRun(companyId, period));
  return db.transaction(async (tx) => {
    const acc = async (code: string) => accountIdByCode(tx, companyId, code);
    const [a541, a471, a462, a463, a561, a551, aTv] = await Promise.all(["541", "471", "462", "463", "561", "551", m.params.memberTbAccount].map(acc));
    const lines: Array<{ accountId: number; debit: number; credit: number; description: string }> = [];
    const pair = (d: number, c: number, amount: number, description: string) => {
      if (amount > 0.004) lines.push({ accountId: d, debit: amount, credit: 0, description }, { accountId: c, debit: 0, credit: amount, description });
    };
    for (const r of m.rows) {
      const x = r.result, n = r.name;
      pair(a541, a471, x.gross, `${n}: ${isEfo(r.employment.kind) ? `alkalmi munkabér (${r.input.efoDays ?? 0} nap)` : x.overtimePay ? `bruttó bér (túlórapótlékkal ${x.overtimePay} Ft)` : "bruttó bér"}`);
      pair(a471, a462, x.szja, `${n}: SZJA-előleg`);
      pair(a471, a463, x.tb, `${n}: TB-járulék`);
      pair(a561, a463, x.szocho, `${n}: szociális hozzájárulási adó`);
      pair(aTv, a463, x.tbCompany, `${n}: minimum TB-járulék (a társaság viseli)`);
      pair(a561, a463, x.efoTax, `${n}: EFO közteher`);
      pair(a551, a471, x.benefitTotal, `${n}: béren kívüli juttatás`);
      pair(a551, a462, x.benefitSzja, `${n}: juttatás SZJA (munkáltató)`);
      pair(a561, a463, x.benefitSzocho, `${n}: juttatás szocho`);
    }
    if (!lines.length) throw new Error("Nincs könyvelendő összeg (minden sor 0).");
    const entry = await postEntry(tx, { companyId, journalCode: "VN", date: periodEnd(period), userId, sourceType: "payroll", sourceId: run.id, description: `Bérszámfejtés ${period}`, lines });
    for (const r of m.rows) {
      await tx.insert(s.payrollItems).values({ runId: run.id, employmentId: r.employmentId, input: r.input, result: r.result as unknown as Record<string, unknown> })
        .onConflictDoUpdate({ target: [s.payrollItems.runId, s.payrollItems.employmentId], set: { result: r.result as unknown as Record<string, unknown> } });
    }
    await tx.update(s.payrollRuns).set({ status: "posted", journalEntryId: entry.id, postedAt: new Date() }).where(eq(s.payrollRuns.id, run.id));
    return entry;
  });
}

/** Könyvelés visszavonása: storno a hónap utolsó napjával, a hónap újra szerkeszthető. */
export async function unpostMonth(companyId: number, period: string, userId?: number) {
  const [run] = await db.select().from(s.payrollRuns).where(and(eq(s.payrollRuns.companyId, companyId), eq(s.payrollRuns.period, period)));
  if (!run || run.status !== "posted" || !run.journalEntryId) throw new Error("A hónap nincs könyvelve.");
  return db.transaction(async (tx) => {
    const rev = await reverseEntry(tx, companyId, run.journalEntryId!, periodEnd(period), userId, "bérszámfejtés visszavonása");
    await tx.update(s.payrollRuns).set({ status: "draft", journalEntryId: null, postedAt: null }).where(eq(s.payrollRuns.id, run.id));
    return rev;
  });
}

/** Mely hónapok nincsenek még könyvelve az adott évben (élő jogviszony mellett), a folyó hónapig. */
export async function openMonths(companyId: number, year: number) {
  const emps = await db.select().from(s.employments).where(eq(s.employments.companyId, companyId));
  if (!emps.length) return [];
  const runs = await db.select().from(s.payrollRuns).where(and(eq(s.payrollRuns.companyId, companyId), like(s.payrollRuns.period, `${year}-%`), eq(s.payrollRuns.status, "posted")));
  const cur = today().slice(0, 7);
  const out: string[] = [];
  for (let m = 1; m <= 12; m++) {
    const p = `${year}-${String(m).padStart(2, "0")}`;
    if (p >= cur) break; // a folyó hónap a hónap végén zárul
    if (runs.some((r) => r.period === p)) continue;
    if (emps.some((e) => (isEfo(e.kind as EmploymentKind) ? e.startDate <= periodEnd(p) && (!e.endDate || e.endDate >= `${p}-01`) : prorateOf(toEmployment(e), p) > 0))) out.push(p);
  }
  return out;
}

export async function deleteEmployment(companyId: number, id: number) {
  const used = await db.select({ id: s.payrollItems.id }).from(s.payrollItems).innerJoin(s.payrollRuns, eq(s.payrollRuns.id, s.payrollItems.runId))
    .where(and(eq(s.payrollItems.employmentId, id), eq(s.payrollRuns.status, "posted")));
  if (used.length) throw new Error("Ehhez a jogviszonyhoz már van könyvelt hónap – törlés helyett add meg a megszűnés dátumát.");
  await db.delete(s.employments).where(and(eq(s.employments.companyId, companyId), eq(s.employments.id, id)));
}

export async function deleteEmployee(companyId: number, id: number) {
  const emps = await db.select({ id: s.employments.id }).from(s.employments).where(and(eq(s.employments.companyId, companyId), eq(s.employments.employeeId, id)));
  for (const e of emps) await deleteEmployment(companyId, e.id);
  await db.delete(s.employees).where(and(eq(s.employees.companyId, companyId), eq(s.employees.id, id)));
}

