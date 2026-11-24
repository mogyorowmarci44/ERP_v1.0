/** v3.10.0 – A banki hozzájárulás visszahívásának `state` paramétere: aláírt, 20 percig érvényes (cég + felhasználó + beállítás). */
import "server-only";
import { jwtVerify, SignJWT } from "jose";

const key = () => new TextEncoder().encode(`bank-state:${process.env.SESSION_SECRET ?? "dev-secret"}`);

export type BankState = { cid: number; uid: number; aspsp: string; country: string; psuType: "business" | "personal"; since: string };

export async function signState(s: BankState): Promise<string> {
  return new SignJWT({ ...s }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("20m").sign(key());
}

export async function verifyState(token: string): Promise<BankState> {
  const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
  const p = payload as unknown as BankState;
  if (!Number.isInteger(p.cid) || !Number.isInteger(p.uid) || !p.aspsp) throw new Error("Érvénytelen visszahívás.");
  return p;
}

export function appBaseUrl(req?: Request): string {
  const env = (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/$/, "");
  if (env) return env;
  if (!req) return "";
  const u = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? u.host;
  const proto = req.headers.get("x-forwarded-proto") ?? u.protocol.replace(":", "");
  return `${proto}://${host}`;
}
