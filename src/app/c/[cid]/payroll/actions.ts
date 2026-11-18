"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCompany } from "@/lib/auth";
import { errMsg, runOrRedirect, str, optStr } from "@/lib/action-utils";
import { parseNumber } from "@/lib/money";
import { isDate } from "@/lib/dates";
import { deleteEmployee, deleteEmployment, postMonth, saveMonth, saveParams, unpostMonth } from "@/lib/payroll";
import { KIND_LABEL, PARAM_LABELS, defaultParams, type EmploymentKind, type PayrollInput, type PayrollParams } from "@/lib/payroll-calc";

const isPeriod = (p: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(p);
const ok = (url: string, msg: string) => `${url}${url.includes("?") ? "&" : "?"}ok=${encodeURIComponent(msg)}`;

export async function savePayrollAction(cid: number, period: string, inputs: Record<number, PayrollInput>): Promise<{ error?: string }> {
  await requireCompany(cid, { write: true });
  try {
    if (!isPeriod(period)) throw new Error("Hibás hónap.");
    await saveMonth(cid, period, inputs);
    revalidatePath(`/c/${cid}/payroll`);
    return {};
  } catch (e) {
    return { error: errMsg(e) };
  }
}

export async function postPayrollAction(fd: FormData) {
  const cid = Number(fd.get("cid")), period = str(fd, "period");
  const { user } = await requireCompany(cid, { write: true });
  const back = `/c/${cid}/payroll?period=${period}`;
  await runOrRedirect(back, async () => {
    const e = await postMonth(cid, period, user.id);
    revalidatePath(`/c/${cid}`, "layout");
    return ok(back, `Bérszámfejtés ${period} könyvelve: ${e.number}.`);
  });
}

export async function unpostPayrollAction(fd: FormData) {
  const cid = Number(fd.get("cid")), period = str(fd, "period");
  const { user } = await requireCompany(cid, { write: true });
  const back = `/c/${cid}/payroll?period=${period}`;
  await runOrRedirect(back, async () => {
    const e = await unpostMonth(cid, period, user.id);
    revalidatePath(`/c/${cid}`, "layout");
    return ok(back, `Könyvelés visszavonva (storno: ${e.number}). A hónap újra szerkeszthető.`);
  });
}

// --- dolgozók, jogviszonyok ------------------------------------------------------------------

export async function saveEmployeeAction(fd: FormData) {
  const cid = Number(fd.get("cid"));
  await requireCompany(cid, { write: true });
  const back = `/c/${cid}/payroll/people`;
  await runOrRedirect(back, async () => {
    const id = Number(fd.get("id")) || null;
    const v = { name: str(fd, "name"), taxId: optStr(fd, "taxId"), position: optStr(fd, "position"), note: optStr(fd, "note") };
    if (!v.name) throw new Error("A név kötelező.");
    if (v.taxId && !/^\d{10}$/.test(v.taxId.replace(/\D/g, ""))) throw new Error("Az adóazonosító jel 10 számjegy.");
    if (id) await db.update(schema.employees).set(v).where(and(eq(schema.employees.companyId, cid), eq(schema.employees.id, id)));
    else {
      const [e] = await db.insert(schema.employees).values({ companyId: cid, ...v }).returning();
      return `${ok(back, `${v.name} felvéve – add meg a jogviszonyát.`)}#emp-${e.id}`;
    }
    return ok(back, "Mentve.");
  });
}

export async function deleteEmployeeAction(fd: FormData) {
  const cid = Number(fd.get("cid"));
  await requireCompany(cid, { write: true });
  await runOrRedirect(`/c/${cid}/payroll/people`, async () => {
    await deleteEmployee(cid, Number(fd.get("id")));
    return ok(`/c/${cid}/payroll/people`, "Dolgozó törölve.");
  });
}

export async function saveEmploymentAction(fd: FormData) {
  const cid = Number(fd.get("cid"));
  await requireCompany(cid, { write: true });
  const back = `/c/${cid}/payroll/people`;
  await runOrRedirect(back, async () => {
    const id = Number(fd.get("id")) || null;
    const kind = str(fd, "kind") as EmploymentKind;
    if (!(kind in KIND_LABEL)) throw new Error("Válassz jogviszonyt.");
    const startDate = str(fd, "startDate"), endDate = optStr(fd, "endDate");
    if (!isDate(startDate) || (endDate && !isDate(endDate))) throw new Error("Hibás dátum.");
    if (endDate && endDate < startDate) throw new Error("A megszűnés nem lehet a kezdés előtt.");
    const efo = kind === "efo_casual" || kind === "efo_seasonal";
    const v = {
      kind, startDate, endDate,
      monthlyWage: efo ? 0 : parseNumber(fd.get("monthlyWage")),
      dailyWage: efo ? parseNumber(fd.get("dailyWage")) : 0,
      weeklyHours: kind === "part" ? Math.round(parseNumber(fd.get("weeklyHours"))) || 20 : null,
      guaranteedMin: fd.get("guaranteedMin") === "on",
      note: optStr(fd, "note"),
    };
    if (efo && !(v.dailyWage > 0)) throw new Error("Alkalmi / idénymunkánál add meg a napidíjat.");
    if (id) await db.update(schema.employments).set(v).where(and(eq(schema.employments.companyId, cid), eq(schema.employments.id, id)));
    else await db.insert(schema.employments).values({ companyId: cid, employeeId: Number(fd.get("employeeId")), ...v });
    return ok(back, "Jogviszony mentve.");
  });
}

export async function deleteEmploymentAction(fd: FormData) {
  const cid = Number(fd.get("cid"));
  await requireCompany(cid, { write: true });
  await runOrRedirect(`/c/${cid}/payroll/people`, async () => {
    await deleteEmployment(cid, Number(fd.get("id")));
    return ok(`/c/${cid}/payroll/people`, "Jogviszony törölve.");
  });
}

// --- paraméterek ---------------------------------------------------------------------------

export async function saveParamsAction(fd: FormData) {
  const cid = Number(fd.get("cid")), year = Number(fd.get("year"));
  const { role } = await requireCompany(cid, { write: true });
  const back = `/c/${cid}/payroll/params?year=${year}`;
  await runOrRedirect(back, async () => {
    if (role !== "owner") throw new Error("A paramétereket csak tulajdonos módosíthatja (minden cégre érvényesek).");
    if (!(year >= 2020 && year <= 2100)) throw new Error("Hibás év.");
    const base = defaultParams(year);
    const v = { ...base } as Record<string, number | string>;
    for (const { key } of PARAM_LABELS) {
      if (typeof base[key] === "string") v[key] = str(fd, key) || String(base[key]);
      else { const n = parseNumber(fd.get(key)); if (!(n >= 0)) throw new Error(`Hibás érték: ${key}`); v[key] = n; }
    }
    await saveParams(year, v as unknown as PayrollParams);
    revalidatePath(`/c/${cid}/payroll`);
    return ok(back, `${year}. évi paraméterek mentve.`);
  });
}
