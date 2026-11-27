import { describe, expect, it } from "vitest";
import { fingerprint, isControlFlow, isSystemError } from "../src/lib/error-log-calc";

describe("hibanapló (v6.7.0)", () => {
  it("programhiba vs. felhasználói üzenet", () => {
    expect(isSystemError(new Error("A számla neve kötelező."))).toBe(false);
    expect(isSystemError(new TypeError("x is undefined"))).toBe(true);
    expect(isSystemError(Object.assign(new Error("Failed query: select …"), { cause: { code: "42703" } }))).toBe(true);
    expect(isSystemError(Object.assign(new Error("Failed query: insert …"), { cause: { code: "23505" } }))).toBe(false);
    expect(isSystemError(new Error("connect ECONNREFUSED 127.0.0.1:5432"))).toBe(true);
  });
  it("csoportosítás: számok és azonosítók nélkül azonos", () => {
    const a = fingerprint("Invoice 123 not found", "Error\n    at f (/app/src/lib/x.ts:10:5)", "/c/3/invoices/55");
    const b = fingerprint("Invoice 9876 not found", "Error\n    at f (/app/src/lib/x.ts:12:9)", "/c/7/invoices/1");
    expect(a).toBe(b);
    expect(fingerprint("Más hiba", null, "/c/3")).not.toBe(a);
  });
  it("Next.js vezérlő-hibák kimaradnak", () => {
    expect(isControlFlow({ digest: "NEXT_REDIRECT;replace;/x;307;" })).toBe(true);
    expect(isControlFlow(new Error("x"))).toBe(false);
  });
});
