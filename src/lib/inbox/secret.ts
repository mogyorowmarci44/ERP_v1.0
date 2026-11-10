/** Forrás-kulcsok titkosítása az adatbázisban (AES-256-GCM, a SESSION_SECRET-ből származtatott kulccsal). */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const key = () => createHash("sha256").update(`inbox:${process.env.SESSION_SECRET ?? "dev-secret"}`).digest();

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64");
}
export function decryptSecret(b64: string): string {
  const buf = Buffer.from(b64, "base64");
  const d = createDecipheriv("aes-256-gcm", key(), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
}
