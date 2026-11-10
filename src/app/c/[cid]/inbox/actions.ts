"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { InboxProposal } from "@/db/schema";
import { requireCompany } from "@/lib/auth";
import { runOrRedirect, str, optStr } from "@/lib/action-utils";
import { parseNumber } from "@/lib/money";
import { isDate } from "@/lib/dates";
import { encryptSecret } from "@/lib/inbox/secret";
import { pingRemote } from "@/lib/inbox/connector";
import { addDocument, getInboxSettings, saveInboxSettings, runSync, processDocument, bookInvoiceProposal, bookStatementRows, loadProposeCtx, propose } from "@/lib/inbox/service";

const { inboxDocuments } = schema;
const cidOf = (fd: FormData) => Number(fd.get("cid"));
const base = (cid: number) => `/c/${cid}/inbox`;
const refresh = (cid: number) => { revalidatePath(base(cid), "layout"); revalidatePath(`/c/${cid}`, "layout"); };

async function ownDoc(cid: number, id: number) {
  const [d] = await db.select().from(inboxDocuments).where(and(eq(inboxDocuments.id, id), eq(inboxDocuments.companyId, cid)));
  if (!d) throw new Error("A bizonylat nem található.");
  return d;
}

/** A gomb: beolvasás minden forrásból + feldolgozás + könyvelés. */
export async function syncAction(fd: FormData) {
  const cid = cidOf(fd);
  const { user } = await requireCompany(cid, { write: true });
  await runOrRedirect(base(cid), async () => {
    const s = await runSync(cid, user.id);
    refresh(cid);
    const q = new URLSearchParams({ sync: JSON.stringify(s) });
    return `${base(cid)}?${q}`;
  });
}

/** Kézi feltöltés (több fájl, telefonról fotó is). */
export async function uploadAction(fd: FormData) {
  const cid = cidOf(fd);
  const { user } = await requireCompany(cid, { write: true });
  await runOrRedirect(base(cid), async () => {
    const kind = str(fd, "kind") === "statement" ? "statement" : "invoice";
    const files = fd.getAll("files").filter((f): f is File => typeof f === "object" && "arrayBuffer" in f && (f as File).size > 0);
    if (!files.length) throw new Error("Válassz ki legalább egy fájlt.");
    const ids: number[] = [];
    for (const f of files) {
      if (f.size > 20 * 1024 * 1024) throw new Error(`${f.name}: túl nagy (max. 20 MB).`);
      const data = Buffer.from(await f.arrayBuffer()).toString("base64");
      const id = await addDocument(cid, { source: "upload", sourceRef: `upload:${Date.now()}:${randomBytes(4).toString("hex")}`, kind, filename: f.name || "feltoltes", mime: f.type || "application/octet-stream", data });
      if (id) ids.push(id);
    }
    let msg = `${ids.length} fájl feltöltve.`;
    {
      const { settings } = await getInboxSettings(cid);
      let booked = 0, review = 0;
      for (const id of ids) {
        try {
          const r = await processDocument(cid, id, user.id, { autoPost: settings.autoPost !== false });
          if (r === "booked") booked++; else if (r === "review") review++;
        } catch (e) {
          await db.update(inboxDocuments).set({ status: "error", error: (e as Error).message }).where(eq(inboxDocuments.id, id));
        }
      }
      msg += ` Lekönyvelve: ${booked}, jóváhagyásra vár: ${review}.`;
    }
    refresh(cid);
    return `${base(cid)}?ok=${encodeURIComponent(msg)}`;
  });
}

/** Folder ID kinyerése Drive-linkből is. */
const folderId = (v: string | null) => (v ? (v.match(/folders\/([A-Za-z0-9_-]{10,})/)?.[1] ?? v.replace(/[^A-Za-z0-9_-]/g, "")) : null);

export async function saveSettingsAction(fd: FormData) {
  const cid = cidOf(fd);
  await requireCompany(cid, { write: true });
  await runOrRedirect(`${base(cid)}/settings`, async () => {
    const { settings } = await getInboxSettings(cid);
    const url = optStr(fd, "scriptUrl");
    if (url && !/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url)) throw new Error("A web app címe így néz ki: https://script.google.com/macros/s/…/exec");
    const since = optStr(fd, "since");
    if (since && !isDate(since)) throw new Error("Hibás dátum.");
    const secret = optStr(fd, "secret");
    await saveInboxSettings(cid, {
      ...settings,
      scriptUrl: url,
      secretEnc: secret ? encryptSecret(secret) : settings.secretEnc ?? null,
      gmailQuery: optStr(fd, "gmailQuery"),
      invoiceFolderId: folderId(optStr(fd, "invoiceFolder")),
      statementFolderId: folderId(optStr(fd, "statementFolder")),
      since,
      autoPost: fd.get("autoPost") === "on",
    });
    refresh(cid);
    return `${base(cid)}/settings?ok=${encodeURIComponent("Beállítások mentve.")}`;
  });
}

/** Új kulcs generálása – ezt kell beírni a Google-szkriptbe. */
export async function newSecretAction(fd: FormData) {
  const cid = cidOf(fd);
  await requireCompany(cid, { write: true });
  await runOrRedirect(`${base(cid)}/settings`, async () => {
    const { settings } = await getInboxSettings(cid);
    const secret = randomBytes(18).toString("base64url");
    await saveInboxSettings(cid, { ...settings, secretEnc: encryptSecret(secret) });
    return `${base(cid)}/settings?secret=${encodeURIComponent(secret)}`;
  });
}

export async function testConnectionAction(fd: FormData) {
  const cid = cidOf(fd);
  await requireCompany(cid, { write: true });
  await runOrRedirect(`${base(cid)}/settings`, async () => {
    const { settings } = await getInboxSettings(cid);
    const r = await pingRemote(settings);
    return `${base(cid)}/settings?ok=${encodeURIComponent(`Kapcsolat rendben: ${r.account}`)}`;
  });
}

export async function ignoreDocAction(fd: FormData) {
  const cid = cidOf(fd);
  await requireCompany(cid, { write: true });
  await runOrRedirect(base(cid), async () => {
    const id = Number(fd.get("id"));
    await ownDoc(cid, id);
    await db.update(inboxDocuments).set({ status: "ignored", processedAt: new Date() }).where(eq(inboxDocuments.id, id));
    refresh(cid);
    return `${base(cid)}?ok=${encodeURIComponent("Kihagyva.")}`;
  });
}

/** Újra-feldolgozás (pl. új partner vagy gépkocsi felvétele után); a „reread” a kiolvasást is megismétli. */
export async function reprocessAction(fd: FormData) {
  const cid = cidOf(fd);
  const { user } = await requireCompany(cid, { write: true });
  const id = Number(fd.get("id"));
  await runOrRedirect(`${base(cid)}/${id}`, async () => {
    const d = await ownDoc(cid, id);
    if (d.status === "booked") throw new Error("Már könyvelve.");
    if (fd.get("reread") === "1") await db.update(inboxDocuments).set({ extracted: null, status: "new" }).where(eq(inboxDocuments.id, id));
    const r = await processDocument(cid, id, user.id, { autoPost: false });
    refresh(cid);
    return `${base(cid)}/${id}?ok=${encodeURIComponent(r === "review" ? "Javaslat frissítve." : r === "duplicate" ? "Már könyvelve van." : "Feldolgozva.")}`;
  });
}

/** Számla könyvelése a (javított) jóváhagyási űrlapról. */
export async function bookInvoiceAction(fd: FormData) {
  const cid = cidOf(fd);
  const { user } = await requireCompany(cid, { write: true });
  const id = Number(fd.get("id"));
  await runOrRedirect(`${base(cid)}/${id}`, async () => {
    const d = await ownDoc(cid, id);
    if (d.status === "booked") throw new Error("Már könyvelve.");
    const prev = d.proposal?.invoice;
    const n = Number(fd.get("lineCount") ?? 0);
    const lines: NonNullable<InboxProposal["invoice"]>["lines"] = [];
    for (let i = 0; i < n; i++) {
      if (fd.get(`l${i}_del`) === "on") continue;
      if (!str(fd, `l${i}_desc`) && !parseNumber(fd.get(`l${i}_unit`))) continue; // üres pótsor
      const veh = str(fd, `l${i}_vehicle`);
      lines.push({
        description: str(fd, `l${i}_desc`) || "Tétel",
        quantity: parseNumber(fd.get(`l${i}_qty`)) || 1,
        unitPrice: parseNumber(fd.get(`l${i}_unit`)),
        accountCode: str(fd, `l${i}_acc`),
        vatCode: str(fd, `l${i}_vat`),
        vehicleId: veh && veh !== "new" ? Number(veh) : null,
        newVehicle: veh === "new",
      });
    }
    if (!lines.length) throw new Error("Nincs tétel.");
    const partnerSel = str(fd, "partnerId");
    for (const k of ["issueDate", "fulfillmentDate"]) if (!isDate(str(fd, k))) throw new Error("Hibás dátum.");
    const payNow = fd.get("payNow") === "on";
    const prop: NonNullable<InboxProposal["invoice"]> = {
      direction: str(fd, "direction") === "out" ? "out" : "in",
      partner: partnerSel && partnerSel !== "new"
        ? { id: Number(partnerSel), name: "", privatePerson: false }
        : { id: null, name: str(fd, "partnerName") || "Ismeretlen", taxNumber: optStr(fd, "partnerTax"), privatePerson: fd.get("partnerPrivate") === "on", country: (str(fd, "partnerCountry") || "HU").toUpperCase() },
      invoiceNumber: str(fd, "invoiceNumber"),
      issueDate: str(fd, "issueDate"),
      fulfillmentDate: str(fd, "fulfillmentDate"),
      dueDate: isDate(str(fd, "dueDate")) ? str(fd, "dueDate") : null,
      paymentMethod: (["cash", "card", "transfer"].includes(str(fd, "paymentMethod")) ? str(fd, "paymentMethod") : "transfer") as "cash" | "card" | "transfer",
      currency: (str(fd, "currency") || "HUF").toUpperCase(),
      periodic: fd.get("periodic") === "on",
      lines,
      payNow: payNow ? { date: isDate(str(fd, "payDate")) ? str(fd, "payDate") : str(fd, "fulfillmentDate"), accountCode: str(fd, "payAccount") || "381" } : null,
      vehicle: lines.some((l) => l.newVehicle) ? { make: str(fd, "vehMake") || prev?.vehicle?.make || "Gépkocsi", model: str(fd, "vehModel") || prev?.vehicle?.model || "", plate: optStr(fd, "vehPlate"), vin: optStr(fd, "vehVin") } : null,
    };
    if (!prop.invoiceNumber) throw new Error("Hiányzik a számlaszám.");
    const invId = await bookInvoiceProposal(cid, id, prop, user.id, d.sourceUrl ?? `/c/${cid}/inbox/${id}/file`);
    refresh(cid);
    return `/c/${cid}/invoices/${invId}?ok=${encodeURIComponent("Lekönyvelve a beérkező bizonylatból.")}`;
  });
}

/** Kivonat-sor kézi párosítása / könyvelése. */
export async function statementRowAction(fd: FormData) {
  const cid = cidOf(fd);
  const { user } = await requireCompany(cid, { write: true });
  const id = Number(fd.get("id"));
  await runOrRedirect(`${base(cid)}/${id}`, async () => {
    const d = await ownDoc(cid, id);
    const prop = d.proposal;
    if (!prop?.statement) throw new Error("Nincs kivonat-javaslat.");
    const idx = Number(fd.get("idx"));
    const row = prop.statement.rows.find((r) => r.idx === idx);
    if (!row) throw new Error("A sor nem található.");
    const choice = str(fd, "choice");
    if (choice === "skip") { row.action = "skip"; row.reason = "kihagyva (kézzel)"; }
    else if (choice.startsWith("inv:")) { row.action = "pay_invoice"; row.invoiceId = Number(choice.slice(4)); }
    else if (choice.startsWith("acc:")) { row.action = "entry"; row.accountCode = choice.slice(4); }
    else if (choice === "cashin") { row.action = "transfer"; row.accountCode = "381"; }
    else throw new Error("Válassz műveletet.");
    await bookStatementRows(cid, id, prop, user.id, choice === "skip" ? [] : [idx]);
    refresh(cid);
    return `${base(cid)}/${id}`;
  });
}

/** A meglévő kivonat-javaslat újraszámolása (pl. a számlák felvétele után). */
export async function repairStatementAction(fd: FormData) {
  const cid = cidOf(fd);
  const { user } = await requireCompany(cid, { write: true });
  const id = Number(fd.get("id"));
  await runOrRedirect(`${base(cid)}/${id}`, async () => {
    const d = await ownDoc(cid, id);
    if (!d.extracted) throw new Error("Még nincs kiolvasva.");
    const done = new Set((d.proposal?.statement?.rows ?? []).filter((r) => r.done).map((r) => r.idx));
    const p = propose(await loadProposeCtx(cid), "statement", d.extracted);
    for (const r of p.statement?.rows ?? []) if (done.has(r.idx)) { r.done = true; r.action = "skip"; r.reason = "már könyvelve"; }
    await bookStatementRows(cid, id, p, user.id);
    refresh(cid);
    return `${base(cid)}/${id}?ok=${encodeURIComponent("Párosítás frissítve.")}`;
  });
}
