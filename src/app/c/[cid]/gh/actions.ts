"use server";
/** v2.0 – Vendégház: gyors rögzítés (költség, közvetlen foglalás), sztornó, diszkontráta. */
import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCompany } from "@/lib/auth";
import { runOrRedirect, str } from "@/lib/action-utils";
import { parseNumber } from "@/lib/money";
import { isDate } from "@/lib/dates";
import { manualEntry, reverseEntry } from "@/lib/ledger";
import { DEFAULT_TAX_PROFILE, isPrivate } from "@/lib/entity";
import { addMonths, daysBetween, monthEndOf } from "@/lib/gh-calc";
import { today } from "@/lib/dates";

const cidOf = (fd: FormData) => Number(fd.get("cid"));

async function accountIds(cid: number, codes: string[]) {
  const rows = await db
    .select({ id: schema.accounts.id, code: schema.accounts.code, isPosting: schema.accounts.isPosting })
    .from(schema.accounts)
    .where(and(eq(schema.accounts.companyId, cid), inArray(schema.accounts.code, codes)));
  const m = new Map(rows.filter((r) => r.isPosting).map((r) => [r.code, r.id]));
  for (const c of codes) if (!m.has(c)) throw new Error(`A(z) ${c} számla nem könyvelhető ennél a cégnél.`);
  return m;
}

function amountOf(fd: FormData, k: string) {
  const v = parseNumber(str(fd, k));
  if (v === null || !Number.isFinite(v) || v <= 0) throw new Error("Az összeg legyen pozitív szám.");
  return Math.round(v);
}

const isMoneyCode = (c: string) => (c.startsWith("38") && !c.startsWith("389")) || c === "4191" || c === "4192";

/** Költség rögzítése: T költségszámla / K pénz (bank vagy magánpénz), opcionálisan havonta ismételve. */
export async function addCostAction(fd: FormData) {
  const cid = cidOf(fd);
  const { user, company } = await requireCompany(cid, { write: true });
  const back = `/c/${cid}/gh/costs`;
  await runOrRedirect(back, async () => {
    if (!isPrivate(company)) throw new Error("Csak vendégháznál (adószámos magánszemély).");
    const date = str(fd, "date");
    if (!isDate(date)) throw new Error("Hibás dátum.");
    const cost = str(fd, "account");
    if (!/^[58]\d*$/.test(cost)) throw new Error("Válassz költségkategóriát.");
    const pay = str(fd, "pay");
    if (!isMoneyCode(pay)) throw new Error("Válaszd ki, miből fizetted.");
    const amount = amountOf(fd, "amount");
    const text = str(fd, "description");
    if (!text) throw new Error("A megnevezés kötelező.");
    const monthly = fd.get("monthly") === "on";
    const repeat = Math.min(36, Math.max(1, Number(str(fd, "repeat")) || 1));
    const ids = await accountIds(cid, [cost, pay]);
    const journalCode = pay.startsWith("38") ? "BA" : "VN";
    await db.transaction(async (tx) => {
      for (let i = 0; i < repeat; i++) {
        const d0 = addMonths(date, i);
        // havi költség: a hónap utolsó napjára, „ÉÉÉÉ. HH.” jelöléssel → a kimutatások a hónap napjaira osztják
        const d = monthly ? monthEndOf(d0) : d0;
        const desc = monthly ? `${text} ${d.slice(0, 4)}. ${d.slice(5, 7)}.` : text;
        await manualEntry(
          cid,
          {
            journalCode,
            date: d,
            description: desc,
            lines: [
              { accountId: ids.get(cost)!, debit: amount, credit: 0, description: desc },
              { accountId: ids.get(pay)!, debit: 0, credit: amount, description: desc },
            ],
          },
          user.id,
          tx,
        );
      }
    });
    revalidatePath(`/c/${cid}`, "layout");
    return `${back}?ok=${encodeURIComponent(repeat > 1 ? `${repeat} havi költség rögzítve.` : "Költség rögzítve.")}`;
  });
}

/** Közvetlen foglalás: T pénz (bank / készpénz-magán) / K 913, a tartózkodás dátumaival és éjszakaszámmal. */
export async function addDirectBookingAction(fd: FormData) {
  const cid = cidOf(fd);
  const { user, company } = await requireCompany(cid, { write: true });
  const back = `/c/${cid}/gh/bookings`;
  await runOrRedirect(back, async () => {
    if (!isPrivate(company)) throw new Error("Csak vendégháznál (adószámos magánszemély).");
    const from = str(fd, "from"), to = str(fd, "to");
    if (!isDate(from) || !isDate(to)) throw new Error("Hibás érkezési / távozási dátum.");
    const nights = daysBetween(from, to);
    if (nights < 1 || nights > 90) throw new Error("A távozás legalább egy nappal az érkezés után legyen (max. 90 éj).");
    const guest = str(fd, "guest").replace(/[()[\]]/g, "") || "Közvetlen vendég";
    const pay = str(fd, "pay");
    if (!(pay.startsWith("38") && !pay.startsWith("389")) && pay !== "4192") throw new Error("Válaszd ki, hová érkezett a pénz.");
    const amount = amountOf(fd, "amount");
    const ids = await accountIds(cid, ["913", pay]);
    const code = `KZ-${from.replaceAll("-", "")}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const desc = `Szállásdíj – ${guest} (${from}–${to}, ${nights} éj) [${code}]`;
    await manualEntry(
      cid,
      {
        journalCode: pay.startsWith("38") ? "BA" : "VN",
        date: from,
        description: desc,
        lines: [
          { accountId: ids.get(pay)!, debit: amount, credit: 0, description: desc },
          { accountId: ids.get("913")!, debit: 0, credit: amount, description: desc },
        ],
      },
      user.id,
    );
    revalidatePath(`/c/${cid}`, "layout");
    return `${back}?year=${from.slice(0, 4)}&ok=${encodeURIComponent(`Foglalás rögzítve: ${nights} éj, ${guest}.`)}`;
  });
}

/** Kézi tétel sztornózása a vendégház-oldalakról. */
export async function ghReverseAction(fd: FormData) {
  const cid = cidOf(fd);
  const { user } = await requireCompany(cid, { write: true });
  const page = str(fd, "page") === "bookings" ? "bookings" : "costs";
  const back = `/c/${cid}/gh/${page}`;
  await runOrRedirect(back, async () => {
    const entryId = Number(fd.get("entryId"));
    const [e] = await db.select().from(schema.journalEntries).where(and(eq(schema.journalEntries.id, entryId), eq(schema.journalEntries.companyId, cid)));
    if (!e) throw new Error("A tétel nem található.");
    if (e.sourceType !== "manual") throw new Error("Számlából származó tételt a bizonylatnál lehet sztornózni.");
    await db.transaction((tx) => reverseEntry(tx, cid, entryId, today(), user.id, "törölve a vendégház-oldalon"));
    revalidatePath(`/c/${cid}`, "layout");
    return `${back}?ok=${encodeURIComponent("Tétel sztornózva.")}`;
  });
}

/** Megtérülés: hosszú távú inflációs feltevés (az MNB-előrejelzés utáni évekre). */
export async function saveDiscountRateAction(fd: FormData) {
  const cid = cidOf(fd);
  const { company } = await requireCompany(cid, { write: true });
  const g = str(fd, "g");
  const back = `/c/${cid}/gh/payback${/^(month|quarter|year|ltd)$/.test(g) ? `?g=${g}` : ""}`;
  await runOrRedirect(back, async () => {
    if (!isPrivate(company)) throw new Error("Csak vendégháznál.");
    const v = parseNumber(str(fd, "rate"));
    if (v === null || !Number.isFinite(v) || v < -5 || v > 50) throw new Error("A hosszú távú infláció −5 és 50% között legyen.");
    const profile = { ...(company.taxProfile ?? DEFAULT_TAX_PROFILE), inflationLongRun: v / 100 };
    await db.update(schema.companies).set({ taxProfile: profile }).where(eq(schema.companies.id, cid));
    revalidatePath(`/c/${cid}`, "layout");
    return `${back}${back.includes("?") ? "&" : "?"}ok=${encodeURIComponent("Hosszú távú inflációs feltevés mentve.")}`;
  });
}

/** Ingatlan adatai és értékbecslési feltevések (fajlagos ár, tőkésítési ráta, berendezések értéke). */
export async function savePropertyAction(fd: FormData) {
  const cid = cidOf(fd);
  const { company } = await requireCompany(cid, { write: true });
  const back = `/c/${cid}/gh/payback?g=${/^(month|quarter|year|ltd)$/.test(str(fd, "g")) ? str(fd, "g") : "year"}`;
  await runOrRedirect(back, async () => {
    if (!isPrivate(company)) throw new Error("Csak vendégháznál.");
    const num = (k: string, max: number) => {
      const raw = str(fd, k).replace(/\s/g, "");
      if (raw === "") return null;
      const v = parseNumber(raw);
      if (!Number.isFinite(v) || v < 0 || v > max) throw new Error(`Hibás érték: ${k}.`);
      return v;
    };
    const cap = num("capRate", 50);
    const property = {
      address: str(fd, "address") || null,
      hrsz: str(fd, "hrsz") || null,
      plotM2: num("plotM2", 1e6),
      floorM2: num("floorM2", 1e4),
      galleryM2: num("galleryM2", 1e4),
      terraceM2: num("terraceM2", 1e4),
      priceM2: num("priceM2", 1e8),
      capRate: cap === null ? null : cap / 100,
      equipmentValue: num("equipmentValue", 1e10),
    };
    const profile = { ...(company.taxProfile ?? DEFAULT_TAX_PROFILE), property };
    await db.update(schema.companies).set({ taxProfile: profile }).where(eq(schema.companies.id, cid));
    revalidatePath(`/c/${cid}`, "layout");
    return `${back}&ok=${encodeURIComponent("Ingatlan adatai mentve.")}#piaci-ertek`;
  });
}
