"use server";
/** v3.3.3 – Évzárás › TAO és HIPA: telephelyek, kézi tételek, HIPA-szabályok frissítése a Kincstártól / feltöltésből. */
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCompany } from "@/lib/auth";
import { runOrRedirect, str } from "@/lib/action-utils";
import { parseNumber } from "@/lib/money";
import { citiesForZip, normName, saveHipaStore, saveImportLog, type HipaSite } from "@/lib/hipa-rules";
import { downloadHakka } from "@/lib/hakka-fetch";
import { parseHakkaFiles } from "@/lib/hakka-parse";
import { today } from "@/lib/dates";

const cidOf = (fd: FormData) => Number(fd.get("cid"));
const back = (cid: number, q = "") => `/c/${cid}/closing/taxes${q}`;
const ok = (cid: number, msg: string, q = "") => `${back(cid, q)}${q ? "&" : "?"}ok=${encodeURIComponent(msg)}`;

async function patchSettings(cid: number, patch: Partial<typeof schema.companies.$inferSelect["settings"]>) {
  const [cur] = await db.select({ settings: schema.companies.settings }).from(schema.companies).where(eq(schema.companies.id, cid));
  await db.update(schema.companies).set({ settings: { ...cur.settings, ...patch } }).where(eq(schema.companies.id, cid));
}

/** Székhely és telephelyek: irányítószám, település (ha az irányítószámhoz több tartozik), szerep, megosztási arány %. */
export async function saveHipaSitesAction(fd: FormData) {
  const cid = cidOf(fd);
  await requireCompany(cid, { write: true });
  await runOrRedirect(back(cid), async () => {
    const zips = fd.getAll("zip").map(String), cities = fd.getAll("city").map(String), roles = fd.getAll("role").map(String), shares = fd.getAll("share").map(String);
    const sites: HipaSite[] = [];
    zips.forEach((z, i) => {
      const zip = z.replace(/\D/g, "").slice(0, 4);
      if (!zip) return;
      const options = citiesForZip(zip);
      if (!options.length) throw new Error(`Ismeretlen irányítószám: ${zip}`);
      const city = options.find((c) => normName(c) === normName(cities[i] ?? "")) ?? options[0];
      sites.push({ zip, city, role: roles[i] === "site" ? "site" : "seat", share: Math.max(0, parseNumber(shares[i] || "0")) / 100 });
    });
    if (sites.length && !sites.some((s) => s.role === "seat")) sites[0].role = "seat";
    const total = sites.reduce((a, s) => a + s.share, 0);
    if (sites.length === 1) sites[0].share = 1;
    else if (sites.length && Math.abs(total - 1) > 0.001) throw new Error(`A megosztási arányok összege ${Math.round(total * 1000) / 10}% – 100% kell legyen.`);
    await patchSettings(cid, { hipaSites: sites });
    revalidatePath(`/c/${cid}`, "layout");
    return ok(cid, sites.length ? `Telephelyek mentve (${sites.length}).` : "Telephelyek törölve – a cég címéből számol.");
  });
}

/** Adóévenkénti kézi tételek és a nyitó (ERP előtti) elhatárolt veszteség. */
export async function saveTaxAdjustmentsAction(fd: FormData) {
  const cid = cidOf(fd);
  const { company } = await requireCompany(cid, { write: true });
  const fy = str(fd, "fy");
  await runOrRedirect(back(cid, `?fy=${fy}`), async () => {
    if (!/^\d{4}$/.test(fy)) throw new Error("Hibás üzleti év.");
    const n = (k: string) => Math.max(0, Math.round(parseNumber(fd.get(k) ?? "0")));
    const all = { ...(company.settings.taxAdjustments ?? {}) };
    all[fy] = { taoIncrease: n("taoIncrease"), taoDecrease: n("taoDecrease"), hipaSubcontract: n("hipaSubcontract"), hipaRnd: n("hipaRnd") };
    const lossYears = fd.getAll("lossYear").map(String), lossAmounts = fd.getAll("lossAmount").map(String);
    const openingLosses = lossYears.map((y, i) => ({ year: y.trim(), amount: Math.max(0, Math.round(parseNumber(lossAmounts[i] || "0"))) }))
      .filter((l) => /^\d{4}$/.test(l.year) && l.amount > 0).sort((a, b) => a.year.localeCompare(b.year));
    await patchSettings(cid, { taxAdjustments: all, openingLosses });
    revalidatePath(`/c/${cid}`, "layout");
    return ok(cid, `${fy}. évi tételek mentve.`, `?fy=${fy}`);
  });
}

async function storeParsed(cid: number, files: { name: string; data: Uint8Array }[], label: string, mode: "kincstar" | "upload", log: string[]) {
  const parsed = await parseHakkaFiles(files, normName, label);
  const count = Object.keys(parsed.rules).length;
  const diagnostics = [...log, ...parsed.diagnostics].slice(0, 120);
  if (count < 50) {
    await saveImportLog({ at: new Date().toISOString(), ok: false, mode, message: `Csak ${count} önkormányzat HIPA-szabályát sikerült kiolvasni – a meglévő adatok maradnak. A részletek lent; küldd el, és igazítom a feldolgozót.`, municipalities: count, withExemption: parsed.withExemption, diagnostics });
    throw new Error(`A fájlból csak ${count} önkormányzat HIPA-szabálya olvasható ki – a meglévő adatok maradtak (részletek a lap alján).`);
  }
  await saveHipaStore({ fetchedAt: new Date().toISOString(), source: label, rules: parsed.rules });
  await saveImportLog({ at: new Date().toISOString(), ok: true, mode, message: `${count} önkormányzat, ebből ${parsed.withExemption} adóalap-mentességgel.`, municipalities: count, withExemption: parsed.withExemption, diagnostics });
  revalidatePath(`/c/${cid}`, "layout");
  return count;
}

/** „Frissítés a Kincstártól” – csak gombnyomásra. */
export async function refreshHakkaAction(fd: FormData) {
  const cid = cidOf(fd);
  await requireCompany(cid, { write: true });
  await runOrRedirect(back(cid), async () => {
    let dl;
    try {
      dl = await downloadHakka();
    } catch (e) {
      const log = (e as { log?: string[] }).log ?? [];
      await saveImportLog({ at: new Date().toISOString(), ok: false, mode: "kincstar", message: `A letöltés nem sikerült: ${(e as Error).message}`, diagnostics: log });
      throw new Error(`A Kincstár letöltése nem sikerült: ${(e as Error).message} (részletek a lap alján). Addig a fájl kézzel is feltölthető.`);
    }
    const count = await storeParsed(cid, dl.files, `Kincstár (HAKKA) · ${dl.label} · letöltve ${today()}`, "kincstar", dl.log);
    return ok(cid, `HIPA-szabályok frissítve a Kincstártól: ${count} önkormányzat.`);
  });
}

/** Kézi feltöltés: a HAKKA oldalon („Az aktuális és korábbi országos havi adatok letölthetők…”) letöltött fájl. */
export async function uploadHakkaAction(fd: FormData) {
  const cid = cidOf(fd);
  await requireCompany(cid, { write: true });
  await runOrRedirect(back(cid), async () => {
    const files = fd.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
    if (!files.length) throw new Error("Nincs kiválasztott fájl.");
    const data = await Promise.all(files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })));
    const count = await storeParsed(cid, data, `Kincstár (HAKKA) · ${files.map((f) => f.name).join(", ")} · feltöltve ${today()}`, "upload", [`Feltöltve: ${files.map((f) => `${f.name} (${Math.round(f.size / 1024)} kB)`).join(", ")}`]);
    return ok(cid, `HIPA-szabályok betöltve a fájlból: ${count} önkormányzat.`);
  });
}
