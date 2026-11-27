/**
 * v6.10.0 – Számlázóprogram-integráció: a számlázz.hu-ban és a Billingóban kiállított számlák
 * behúzása a Beérkező bizonylatok közé (kiolvasott adattal együtt, így nem kell OCR/AI).
 * Csak gombnyomásra fut („Beolvasás és könyvelés” vagy a beállításoknál „Letöltés most”).
 */
import { and, eq, like } from "drizzle-orm";
import { db, schema } from "@/db";
import type { InvoicingLink } from "@/db/schema";
import { decryptSecret } from "@/lib/inbox/secret";
import { addDocument, getInboxSettings, saveInboxSettings } from "@/lib/inbox/service";
import { szamlazzQueryXml, parseSzamlazzResponse, rollYear, fromBillingo, billingoWanted, type BillingoDoc, type SzamlazzResult } from "@/lib/invoicing-sync-calc";
import { today } from "@/lib/dates";

const SZAMLAZZ_URL = process.env.SZAMLAZZ_URL || "https://www.szamlazz.hu/szamla/";
const BILLINGO_URL = process.env.BILLINGO_URL || "https://api.billingo.hu/v3";
const MAX_PER_RUN = 40;
const MISSES_TO_STOP = 3;

export const PROVIDER_LABEL: Record<InvoicingLink["provider"], string> = { szamlazz: "számlázz.hu", billingo: "Billingo" };

export async function szamlazzFetch(agentKey: string, number: string): Promise<SzamlazzResult> {
  const fd = new FormData();
  fd.append("action-szamla_agent_xml", new Blob([szamlazzQueryXml(agentKey, number)], { type: "text/xml" }), "lekerdezes.xml");
  const res = await fetch(SZAMLAZZ_URL, { method: "POST", body: fd, signal: AbortSignal.timeout(30_000) });
  const body = await res.text();
  const code = res.headers.get("szlahu_error_code");
  if (code) {
    const msg = decodeURIComponent(res.headers.get("szlahu_error") ?? "").replace(/\+/g, " ");
    if (code === "7" || /nem (található|létezik)/i.test(msg)) return { kind: "notFound" };
    return { kind: "error", message: `számlázz.hu hiba (${code}): ${msg || body.slice(0, 200)}` };
  }
  if (!res.ok) return { kind: "error", message: `számlázz.hu: HTTP ${res.status}` };
  return parseSzamlazzResponse(body);
}

async function billingoGet(key: string, path: string): Promise<Response> {
  return fetch(`${BILLINGO_URL}${path}`, { headers: { "X-API-KEY": key, Accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
}

async function billingoError(res: Response) {
  const t = await res.text().catch(() => "");
  if (res.status === 401) return "Billingo: érvénytelen API-kulcs.";
  if (res.status === 402) return "Billingo: az API a jelenlegi Billingo-csomagban nem érhető el.";
  if (res.status === 429) return "Billingo: túl sok kérés – próbáld újra pár perc múlva.";
  return `Billingo: HTTP ${res.status} ${t.slice(0, 200)}`;
}

type RunResult = { fetched: number; errors: string[] };

async function runSzamlazz(companyId: number, link: InvoicingLink, budget: number): Promise<RunResult> {
  const out: RunResult = { fetched: 0, errors: [] };
  if (!link.prefix || !link.nextSeq) { out.errors.push("számlázz.hu: add meg az utolsó kiállított számla sorszámát."); return out; }
  const key = decryptSecret(link.keyEnc);
  let prefix = link.prefix;
  let seq = link.nextSeq;
  let misses = 0;
  let triedRoll = false;
  while (out.fetched < budget) {
    const number = `${prefix}${seq}`;
    const r = await szamlazzFetch(key, number);
    if (r.kind === "error") { out.errors.push(`${number}: ${r.message}`); break; }
    if (r.kind === "notFound") {
      misses++;
      if (misses < MISSES_TO_STOP) { seq++; continue; }
      // ennyi hiány után: vagy elfogyott az év (új évszámos előtagra váltunk, ha már új év van), vagy nincs több számla
      const first = seq - misses + 1;
      const rolled = triedRoll ? null : rollYear(prefix, Number(today().slice(0, 4)));
      triedRoll = true;
      if (rolled && (await szamlazzFetch(key, `${rolled}1`)).kind === "ok") { prefix = rolled; seq = 1; misses = 0; continue; }
      seq = first; // a következő futás az első hiányzó sorszámnál folytatja
      break;
    }
    misses = 0;
    const id = await addDocument(companyId, {
      source: "szamlazz", sourceRef: `szamlazz:${number}`, kind: "invoice",
      filename: `${number}.pdf`.replace(/[\\/]/g, "_"), mime: r.pdf ? "application/pdf" : "application/json",
      data: r.pdf ?? Buffer.from(JSON.stringify(r.extracted)).toString("base64"),
      emailSubject: `Kiállított számla ${number} (számlázz.hu)`, emailDate: r.extracted.issueDate ? `${r.extracted.issueDate}T12:00:00Z` : null,
      extracted: r.extracted,
    });
    if (id) out.fetched++;
    seq++;
  }
  link.prefix = prefix;
  link.nextSeq = seq;
  return out;
}

async function runBillingo(companyId: number, link: InvoicingLink, budget: number): Promise<RunResult> {
  const out: RunResult = { fetched: 0, errors: [] };
  const key = decryptSecret(link.keyEnc);
  const known = new Set((await db.select({ r: schema.inboxDocuments.sourceRef }).from(schema.inboxDocuments)
    .where(and(eq(schema.inboxDocuments.companyId, companyId), like(schema.inboxDocuments.sourceRef, "billingo:%")))).map((x) => x.r));
  const since = link.since || today();
  for (let page = 1; page <= 50 && out.fetched < budget; page++) {
    const q = new URLSearchParams({ page: String(page), per_page: "100", start_date: since, end_date: today() });
    const res = await billingoGet(key, `/documents?${q}`);
    if (!res.ok) { out.errors.push(await billingoError(res)); break; }
    const body = (await res.json()) as { data?: BillingoDoc[]; last_page?: number };
    for (const d of body.data ?? []) {
      if (out.fetched >= budget) break;
      const ref = `billingo:${d.id}`;
      if (known.has(ref) || !billingoWanted(d)) continue;
      const x = fromBillingo(d);
      let data: string, mime = "application/pdf";
      const pdf = await billingoGet(key, `/documents/${d.id}/download`).catch(() => null);
      if (pdf && pdf.ok && (pdf.headers.get("content-type") ?? "").includes("pdf")) data = Buffer.from(await pdf.arrayBuffer()).toString("base64");
      else { data = Buffer.from(JSON.stringify(d)).toString("base64"); mime = "application/json"; }
      const id = await addDocument(companyId, {
        source: "billingo", sourceRef: ref, kind: "invoice",
        filename: `${d.invoice_number}.${mime === "application/pdf" ? "pdf" : "json"}`.replace(/[\\/]/g, "_"), mime, data,
        emailSubject: `Kiállított számla ${d.invoice_number} (Billingo)`, emailDate: x.issueDate ? `${x.issueDate}T12:00:00Z` : null,
        extracted: x,
      });
      known.add(ref);
      if (id) out.fetched++;
    }
    if (!body.last_page || page >= body.last_page) break;
  }
  if (out.fetched >= budget) out.errors.push(`Billingo: még lehetnek számlák – nyomd meg újra a gombot.`);
  return out;
}

/** Minden beállított számlázóprogramból behúzza az új számlákat. Az állapotot (sorszám, utolsó futás) visszaírja. */
export async function syncInvoicing(companyId: number): Promise<RunResult> {
  const total: RunResult = { fetched: 0, errors: [] };
  const { settings } = await getInboxSettings(companyId);
  const links = settings.invoicing ?? [];
  if (!links.length) return total;
  for (const link of links) {
    let r: RunResult;
    try {
      r = link.provider === "szamlazz" ? await runSzamlazz(companyId, link, MAX_PER_RUN) : await runBillingo(companyId, link, MAX_PER_RUN);
    } catch (e) {
      r = { fetched: 0, errors: [`${PROVIDER_LABEL[link.provider]}: ${(e as Error).message}`] };
    }
    link.lastRunAt = new Date().toISOString();
    link.lastResult = `${r.fetched} új számla`;
    link.lastError = r.errors.find((e) => !e.includes("nyomd meg újra")) ?? null;
    total.fetched += r.fetched;
    total.errors.push(...r.errors);
  }
  // friss beállítás + csak az invoicing rész cseréje (közben más mező változhatott)
  const fresh = await getInboxSettings(companyId);
  await saveInboxSettings(companyId, { ...fresh.settings, invoicing: links });
  return total;
}

/** Kapcsolat-teszt a mentés előtt: érvényes-e a kulcs. */
export async function testInvoicingKey(provider: InvoicingLink["provider"], key: string, probeNumber?: string | null): Promise<string> {
  if (provider === "billingo") {
    const res = await billingoGet(key, `/documents?page=1&per_page=1`);
    if (!res.ok) throw new Error(await billingoError(res));
    const b = (await res.json()) as { total?: number };
    return `Billingo: kapcsolódva (${b.total ?? 0} bizonylat a fiókban).`;
  }
  if (!probeNumber) throw new Error("Add meg az utolsó kiállított számla sorszámát.");
  const r = await szamlazzFetch(key, probeNumber);
  if (r.kind === "error") throw new Error(r.message);
  if (r.kind === "notFound") throw new Error(`számlázz.hu: a(z) ${probeNumber} számla nem található – ellenőrizd a sorszámot.`);
  return `számlázz.hu: kapcsolódva (${probeNumber}: ${r.extracted.buyer?.name ?? "?"}).`;
}
