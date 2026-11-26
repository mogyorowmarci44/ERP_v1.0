import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * v6.1.0 – Érzékeny személyes adatok mezőszintű titkosítása (AES-256-GCM).
 *
 * Kulcs: DATA_ENCRYPTION_KEY környezeti változó – 32 bájt base64-ben (`openssl rand -base64 32`).
 * Szándékosan NEM a SESSION_SECRET-ből származik: azt kiléptetéshez cserélni szokás, és akkor az adatok olvashatatlanná válnának.
 * Kulcs nélkül a mezők titkosítás nélkül tárolódnak (a régi működés), az üzemeltetői oldal figyelmeztet.
 *
 * Tárolt alak: "enc1:" + base64(iv[12] | tag[16] | rejtjel). A nem így kezdődő érték régi, titkosítatlan adat – olvasáskor változatlanul jön vissza.
 */
export const ENC_PREFIX = "enc1:";
export const MISSING_KEY_TEXT = "(titkosított – hiányzik a DATA_ENCRYPTION_KEY)";

let cached: { raw: string | undefined; key: Buffer | null } | null = null;

export function encryptionKey(): Buffer | null {
  const raw = process.env.DATA_ENCRYPTION_KEY?.trim();
  if (cached && cached.raw === raw) return cached.key;
  let key: Buffer | null = null;
  if (raw) {
    const b = Buffer.from(raw, "base64");
    if (b.length !== 32) throw new Error("A DATA_ENCRYPTION_KEY 32 bájtos, base64 kódolt kulcs legyen (openssl rand -base64 32).");
    key = b;
  }
  cached = { raw, key };
  return key;
}

export const isEncrypted = (v: string | null | undefined) => typeof v === "string" && v.startsWith(ENC_PREFIX);

export function encryptField(plain: string | null | undefined, key: Buffer | null = encryptionKey()): string | null {
  if (plain == null || plain === "") return plain ?? null;
  if (!key || isEncrypted(plain)) return plain;
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ENC_PREFIX + Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64");
}

export function decryptField(stored: string | null | undefined, key: Buffer | null = encryptionKey()): string | null {
  if (stored == null) return null;
  if (!isEncrypted(stored)) return stored;
  if (!key) return MISSING_KEY_TEXT;
  const b = Buffer.from(stored.slice(ENC_PREFIX.length), "base64");
  const d = createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
}

/** Titkosított mezők táblánként (a mentés ezeket visszafejtve tartalmazza, visszaállításkor újra titkosulnak). */
export const ENCRYPTED_COLUMNS: Record<string, string[]> = {
  employees: ["tax_id"],
  company_members: ["tax_id", "mother_name", "birth_place", "address"],
};
