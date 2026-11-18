/** TOTP (RFC 6238, SHA-1, 6 számjegy, 30 mp) – a hitelesítő alkalmazásokkal (Google / Microsoft Authenticator, 1Password …) kompatibilis. */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const TOTP_PERIOD = 30;

export function base32Encode(buf: Uint8Array): string {
  let bits = 0, value = 0, out = "";
  for (const b of buf) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error("Hibás base32 karakter");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

export const stepAt = (ms: number) => Math.floor(ms / 1000 / TOTP_PERIOD);

export function hotp(secret: string, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", base32Decode(secret)).update(msg).digest();
  const off = h[h.length - 1] & 15;
  const code = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(code % 1_000_000).padStart(6, "0");
}

export const totp = (secret: string, ms = Date.now()) => hotp(secret, stepAt(ms));

/**
 * Kód ellenőrzése ±1 lépés (±30 mp) óraeltéréssel. Visszaadja az elfogadott lépést, vagy null-t.
 * `afterStep`: a legutóbb elfogadott lépés – ennél nem régebbi kód nem fogadható el újra (visszajátszás ellen).
 */
export function verifyTotp(secret: string, code: string, opts: { now?: number; afterStep?: number | null } = {}): number | null {
  const c = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return null;
  const cur = stepAt(opts.now ?? Date.now());
  for (const d of [0, -1, 1]) {
    const step = cur + d;
    if (opts.afterStep != null && step <= opts.afterStep) continue;
    if (timingSafeEqual(Buffer.from(hotp(secret, step)), Buffer.from(c))) return step;
  }
  return null;
}

export function otpauthUri(secret: string, account: string, issuer = "mogyorosi.erp") {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${TOTP_PERIOD}`;
}

/** 10 db egyszer használható tartalékkód, „xxxxx-xxxxx” formában. */
export function generateRecoveryCodes(n = 10): string[] {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: n }, () => {
    const b = randomBytes(10);
    const s = [...b].map((x) => alphabet[x % alphabet.length]).join("");
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
}

export const normalizeRecoveryCode = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** A tartalékkódok ~50 bit véletlent hordoznak, ezért elég egy gyors hash (nem kell bcrypt). */
export const hashRecoveryCode = (normalized: string) => createHash("sha256").update(`mmerp-recovery:${normalized}`).digest("hex");
