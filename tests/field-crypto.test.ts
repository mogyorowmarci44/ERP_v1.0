import { describe, expect, it } from "vitest";
import { MISSING_KEY_TEXT, decryptField, encryptField, isEncrypted } from "../src/lib/field-crypto";

const K = Buffer.alloc(32, 1);
const K2 = Buffer.alloc(32, 2);

describe("mezőszintű titkosítás (v6.1.0)", () => {
  it("oda-vissza, minden titkosítás más (véletlen IV)", () => {
    const a = encryptField("8123456789", K)!;
    const b = encryptField("8123456789", K)!;
    expect(isEncrypted(a)).toBe(true);
    expect(a).not.toBe(b);
    expect(decryptField(a, K)).toBe("8123456789");
    expect(decryptField(encryptField("Árvíztűrő Tükörfúrógép", K), K)).toBe("Árvíztűrő Tükörfúrógép");
  });

  it("kulcs nélkül nem titkosít; régi, titkosítatlan adat változatlanul olvasható", () => {
    expect(encryptField("abc", null)).toBe("abc");
    expect(decryptField("abc", K)).toBe("abc");
    expect(encryptField(null, K)).toBeNull();
    expect(encryptField("", K)).toBe("");
  });

  it("nem titkosít kétszer", () => {
    const a = encryptField("x", K)!;
    expect(encryptField(a, K)).toBe(a);
  });

  it("hiányzó kulcsnál jelzőszöveg, rossz kulcsnál hiba (nem csendes adatvesztés)", () => {
    const a = encryptField("titok", K)!;
    expect(decryptField(a, null)).toBe(MISSING_KEY_TEXT);
    expect(() => decryptField(a, K2)).toThrow();
  });
});
