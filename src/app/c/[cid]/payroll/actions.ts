"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCompany } from "@/lib/auth";
import { errMsg, runOrRedirect, str, optStr } from "@/lib/action-utils";
import { parseNumber } from "@/lib/money";
import { isDate } from "@/lib/dates";
import { deleteEmployee, deleteEmployment, markExternal, postMonth, saveMonth, unpostMonth } from "@/lib/payroll";
import { accountIdByCode } from "@/lib/ledger";
import { KIND_LABEL, type EmploymentKind, type PayrollInput } from "@/lib/payroll-calc";
import { withAudit } from "@/lib/audit";

const isPeriod = (p: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(p);
const ok = (url: string, msg: string) => `${url}${url.includes("?") ? "&" : "?"}ok=${encodeURIComponent(msg)}`;

export async function savePayrollAction(cid: number, period: string, inputs: Record<number, PayrollInput>): Promise<{ error?: string }> {
  return withAudit("savePayrollAction", { cid }, () => savePayrollActionImpl(cid, period, inputs));
}

async function savePayrollActionImpl(cid: number, period: string, inputs: Record<number, PayrollInput>): Promise<{ error?: string }> {
  await requireCompany(cid, { write: true, module: "payroll" });
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
  return withAudit("postPayrollAction", fd, () => postPayrollActionImpl(fd));
}

async function postPayrollActionImpl(fd: FormData) {
  const cid = Number(fd.get("cid")), period = str(fd, "period");
  const { user } = await requireCompany(cid, { write: true, module: "payroll" });
  const back = `/c/${cid}/payroll?period=${period}`;
  await runOrRedirect(back, async () => {
    const e = await postMonth(cid, period, user.id, { force: fd.get("force") === "1" });
    revalidatePath(`/c/${cid}`, "layout");
    return ok(back, `Bérszámfejtés ${period} könyvelve: ${e.number}.`);
  });
}

export async function markExternalAction(fd: FormData) {
  return withAudit("markExternalAction", fd, () => markExternalActionImpl(fd));
}

async function markExternalActionImpl(fd: FormData) {
  const cid = Number(fd.get("cid")), period = str(fd, "period"), on = fd.get("on") === "1";
  await requireCompany(cid, { write: true, module: "payroll" });
  const back = `/c/${cid}/payroll?period=${period}`;
  await runOrRedirect(back, async () => {
    if (!isPeriod(period)) throw new Error("Hibás hónap.");
    await markExternal(cid, period, on);
    revalidatePath(`/c/${cid}`, "layout");
    return ok(back, on ? `${period}: kézzel könyveltként jelölve – a modul nem könyvel rá.` : `${period}: jelölés levéve.`);
  });
}

export async function unpostPayrollAction(fd: FormData) {
  return withAudit("unpostPayrollAction", fd, () => unpostPayrollActionImpl(fd));
}

async function unpostPayrollActionImpl(fd: FormData) {
  const cid = Number(fd.get("cid")), period = str(fd, "period");
  const { user } = await requireCompany(cid, { write: true, module: "payroll" });
  const back = `/c/${cid}/payroll?period=${period}`;
  await runOrRedirect(back, async () => {
    const e = await unpostMonth(cid, period, user.id);
    revalidatePath(`/c/${cid}`, "layout");
    return ok(back, `Könyvelés visszavonva (storno: ${e.number}). A hónap újra szerkeszthető.`);
  });
}

// --- dolgozók, jogviszonyok ------------------------------------------------------------------

export async function saveEmployeeAction(fd: FormData) {
  return withAudit("saveEmployeeAction", fd, () => saveEmployeeActionImpl(fd));
}

async function saveEmployeeActionImpl(fd: FormData) {
  const cid = Number(fd.get("cid"));
  await requireCompany(cid, { write: true, module: "payroll" });
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
  return withAudit("deleteEmployeeAction", fd, () => deleteEmployeeActionImpl(fd));
}

async function deleteEmployeeActionImpl(fd: FormData) {
  const cid = Number(fd.get("cid"));
  await requireCompany(cid, { write: true, module: "payroll" });
  await runOrRedirect(`/c/${cid}/payroll/people`, async () => {
    await deleteEmployee(cid, Number(fd.get("id")));
    return ok(`/c/${cid}/payroll/people`, "Dolgozó törölve.");
  });
}

export async function saveEmploymentAction(fd: FormData) {
  return withAudit("saveEmploymentAction", fd, () => saveEmploymentActionImpl(fd));
}

async function saveEmploymentActionImpl(fd: FormData) {
  const cid = Number(fd.get("cid"));
  await requireCompany(cid, { write: true, module: "payroll" });
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
    if (!efo && kind !== "member" && !(v.monthlyWage > 0))
      throw new Error("Munkaviszonyban (teljes / részmunkaidő) az alapbér nem lehet 0. Jövedelem nélküli ügyvezető tagnál a jogviszony: „Társas vállalkozó” – annál a minimum járulékot a társaság fizeti.");
    if (id) await db.update(schema.employments).set(v).where(and(eq(schema.employments.companyId, cid), eq(schema.employments.id, id)));
    else await db.insert(schema.employments).values({ companyId: cid, employeeId: Number(fd.get("employeeId")), ...v });
    return ok(back, "Jogviszony mentve.");
  });
}

export async function deleteEmploymentAction(fd: FormData) {
  return withAudit("deleteEmploymentAction", fd, () => deleteEmploymentActionImpl(fd));
}

async function deleteEmploymentActionImpl(fd: FormData) {
  const cid = Number(fd.get("cid"));
  await requireCompany(cid, { write: true, module: "payroll" });
  await runOrRedirect(`/c/${cid}/payroll/people`, async () => {
    await deleteEmployment(cid, Number(fd.get("id")));
    return ok(`/c/${cid}/payroll/people`, "Jogviszony törölve.");
  });
}

// --- paraméterek ---------------------------------------------------------------------------
// v6.4.0 – a jogszabályi bérparamétereket az üzemeltető tartja karban (Admin › Jogszabályi paraméterek);
// a cég csak a társas vállalkozó helyett viselt járulék költségszámláját állítja.

export async function saveMemberTbAccountAction(fd: FormData) {
  return withAudit("saveMemberTbAccountAction", fd, () => saveMemberTbAccountActionImpl(fd));
}

async function saveMemberTbAccountActionImpl(fd: FormData) {
  const cid = Number(fd.get("cid"));
  const { role, company } = await requireCompany(cid, { write: true, module: "payroll" });
  const back = `/c/${cid}/payroll/params`;
  await runOrRedirect(back, async () => {
    if (role !== "owner") throw new Error("Ezt csak tulajdonos módosíthatja.");
    const code = str(fd, "account") || "551";
    await accountIdByCode(db, cid, code).catch(() => { throw new Error(`A ${code} számla nincs a számlatükörben.`); });
    await db.update(schema.companies).set({ settings: { ...company.settings, payrollMemberTbAccount: code } }).where(eq(schema.companies.id, cid));
    revalidatePath(`/c/${cid}/payroll`);
    return ok(back, "Költségszámla mentve.");
  });
}
