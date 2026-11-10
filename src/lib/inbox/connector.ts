/**
 * Kapcsolat a Google-fiókban futó Apps Script web app-pal (lásd tools/apps-script/mm-erp-inbox.gs).
 * Nincs időzítő: az ERP a „Beolvasás és könyvelés” gombra hívja meg.
 */
import type { InboxSettings } from "@/db/schema";
import { decryptSecret } from "./secret";

export type RemoteItem = {
  ref: string; // pl. gmail:<msgId>:<attIndex> vagy drive:<fileId>
  source: "gmail" | "drive";
  kind: "invoice" | "statement";
  filename: string;
  mime: string;
  size: number;
  url?: string | null;
  from?: string | null;
  subject?: string | null;
  date?: string | null;
};

async function call<T>(s: InboxSettings, body: Record<string, unknown>): Promise<T> {
  if (!s.scriptUrl || !s.secretEnc) throw new Error("A Google-kapcsolat nincs beállítva (Beérkező bizonylatok → Beállítások).");
  const res = await fetch(s.scriptUrl, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" }, // Apps Script: elkerüli a CORS-előkérést, a törzs JSON
    body: JSON.stringify({ ...body, secret: decryptSecret(s.secretEnc) }),
    redirect: "follow",
  });
  const text = await res.text();
  let json: { ok?: boolean; error?: string } & T;
  try { json = JSON.parse(text); } catch { throw new Error(`A Google-szkript nem JSON-t adott vissza (HTTP ${res.status}). Ellenőrizd a web app címét és hogy „Bárki” hozzáférhet-e.`); }
  if (!json.ok) throw new Error(`Google-szkript hiba: ${json.error ?? "ismeretlen"}`);
  return json;
}

/** Új tételek listája (a már ismert hivatkozások nélkül). */
export async function listRemote(s: InboxSettings, known: string[]): Promise<RemoteItem[]> {
  const r = await call<{ items: RemoteItem[] }>(s, {
    action: "list",
    query: s.gmailQuery || "has:attachment (számla OR szamla OR invoice OR rechnung OR díjbekérő OR storno) -in:sent",
    invoiceFolderId: s.invoiceFolderId ?? "",
    statementFolderId: s.statementFolderId ?? "",
    since: s.since ?? "",
    known,
  });
  return r.items;
}

/** Egy tétel tartalma base64-ben (HEIC/HEIF képet a szkript JPEG-re alakít). */
export async function fetchRemote(s: InboxSettings, ref: string): Promise<{ data: string; mime: string; filename: string }> {
  return call<{ data: string; mime: string; filename: string }>(s, { action: "get", ref });
}

export async function pingRemote(s: InboxSettings): Promise<{ account: string }> {
  return call<{ account: string }>(s, { action: "ping" });
}
