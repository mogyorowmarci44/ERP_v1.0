import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, hotp, verifyTotp, generateSecret, generateRecoveryCodes, normalizeRecoveryCode, TOTP_PERIOD } from "../src/lib/totp";

// RFC 6238 B. függelék: SHA-1 kulcs = "12345678901234567890"
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));

describe("totp", () => {
  it("base32 oda-vissza", () => {
    const s = generateSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Encode(base32Decode(s))).toBe(s);
  });

  it("RFC 6238 tesztvektorok (6 jegy)", () => {
    const cases: Array<[number, string]> = [
      [59, "287082"],
      [1111111109, "081804"],
      [1111111111, "050471"],
      [1234567890, "005924"],
      [2000000000, "279037"],
    ];
    for (const [t, code] of cases) expect(hotp(RFC_SECRET, Math.floor(t / TOTP_PERIOD))).toBe(code);
  });

  it("±1 lépés eltérés és visszajátszás elleni védelem", () => {
    const now = 1234567890_000;
    const step = Math.floor(now / 1000 / TOTP_PERIOD);
    const prev = hotp(RFC_SECRET, step - 1);
    expect(verifyTotp(RFC_SECRET, prev, { now })).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step - 2), { now })).toBeNull();
    expect(verifyTotp(RFC_SECRET, prev, { now, afterStep: step - 1 })).toBeNull();
    expect(verifyTotp(RFC_SECRET, "12345", { now })).toBeNull();
    expect(verifyTotp(RFC_SECRET, "abc123", { now })).toBeNull();
  });

  it("tartalékkódok", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/);
    expect(normalizeRecoveryCode(" ABCDE-fghjk ")).toBe("abcdefghjk");
  });
});
