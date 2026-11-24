/**
 * v3.10.0 – Enable Banking API kliens (engedélyes számlainformációs szolgáltató, PSD2).
 *
 * Miért nem közvetlenül az Erste? Az Erste Bank Hungary éles vállalati API-ja (sapigtw.erstebank.hu/psd2/corporate)
 * csak MNB/EBA által engedélyezett harmadik fél szolgáltatónak (TPP, eIDAS-tanúsítvánnyal) érhető el. Az Enable Banking
 * ilyen szolgáltató; a saját, összekapcsolt számlákhoz („restricted” mód) díjmentesen használható.
 *
 * Beállítás (Render környezeti változók):
 *   EB_APP_ID       – az Enable Banking alkalmazás azonosítója (Control Panel → Applications)
 *   EB_PRIVATE_KEY  – az alkalmazás regisztrálásakor letöltött privát kulcs (PEM; a sortörések \n-ként is megadhatók)
 */
import "server-only";
import { importPKCS8, SignJWT } from "jose";
import type { EbTransaction } from "./map";

const API = "https://api.enablebanking.com";

export const ebConfigured = () => !!process.env.EB_APP_ID && !!process.env.EB_PRIVATE_KEY;

let cached: { token: string; exp: number } | null = null;

async function token(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.exp - 60 > now) return cached.token;
  const appId = process.env.EB_APP_ID;
  const pem = process.env.EB_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!appId || !pem) throw new Error("A banki kapcsolat nincs beállítva: hiányzik az EB_APP_ID vagy az EB_PRIVATE_KEY a Render környezeti változói közül.");
  const key = await importPKCS8(pem, "RS256");
  const exp = now + 3600;
  const t = await new SignJWT({})
    .setProtectedHeader({ typ: "JWT", alg: "RS256", kid: appId })
    .setIssuer("enablebanking.com")
    .setAudience("api.enablebanking.com")
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(key);
  cached = { token: t, exp };
  return t;
}

async function api<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json", Accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* nem JSON */ }
  if (!res.ok) {
    const j = (json ?? {}) as { message?: string; error?: string; detail?: unknown };
    const msg = j.message || j.error || (typeof j.detail === "string" ? j.detail : "") || text.slice(0, 300);
    const err = new Error(`Banki API hiba (HTTP ${res.status}): ${msg}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return json as T;
}

export type EbAccount = { uid: string; account_id?: { iban?: string | null } | null; name?: string | null; currency?: string | null; product?: string | null };
export type EbSession = { session_id: string; accounts: EbAccount[]; access?: { valid_until?: string | null } | null; aspsp?: { name: string; country: string } | null };

/** Banki hozzájárulás indítása: a visszakapott címre kell átirányítani a felhasználót (George-jóváhagyás). */
export async function startAuthorization(p: { aspspName: string; country: string; psuType: "business" | "personal"; redirectUrl: string; state: string; validDays: number }) {
  const validUntil = new Date(Date.now() + p.validDays * 86400_000).toISOString();
  return api<{ url: string; authorization_id?: string }>("POST", "/auth", {
    access: { valid_until: validUntil },
    aspsp: { name: p.aspspName, country: p.country },
    state: p.state,
    redirect_url: p.redirectUrl,
    psu_type: p.psuType,
  });
}

/** A visszatérő `code`-ból munkamenet (ez tartalmazza az elérhető számlákat). */
export const createSession = (code: string) => api<EbSession>("POST", "/sessions", { code });

export const deleteSession = (sessionId: string) => api<unknown>("DELETE", `/sessions/${encodeURIComponent(sessionId)}`);

/** Elérhető bankok egy országban (a pontos bank-név kiválasztásához). */
export async function listAspsps(country: string) {
  const r = await api<{ aspsps: Array<{ name: string; country: string; psu_types?: string[] }> }>("GET", `/aspsps?country=${encodeURIComponent(country)}&service=AIS`);
  return r.aspsps ?? [];
}

/** Tranzakciók a megadott naptól (lapozással). */
export async function listTransactions(accountUid: string, dateFrom: string, dateTo?: string): Promise<EbTransaction[]> {
  const out: EbTransaction[] = [];
  let cont: string | undefined;
  for (let page = 0; page < 50; page++) {
    const q = new URLSearchParams({ date_from: dateFrom });
    if (dateTo) q.set("date_to", dateTo);
    if (cont) q.set("continuation_key", cont);
    const r = await api<{ transactions?: EbTransaction[]; continuation_key?: string | null }>("GET", `/accounts/${encodeURIComponent(accountUid)}/transactions?${q}`);
    out.push(...(r.transactions ?? []));
    if (!r.continuation_key) break;
    cont = r.continuation_key;
  }
  return out;
}
