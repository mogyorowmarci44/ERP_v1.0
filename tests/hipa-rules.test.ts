import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ db: {}, schema: {} }));
import { normName, citiesForZip, zipFromAddress, ruleFor, companyHipaSites } from "@/lib/hipa-rules";

describe("HIPA-szabályok – település és irányítószám", () => {
  it("a HAKKA-féle önkormányzat-nevek a településnévre egyszerűsödnek", () => {
    expect(normName("Mór Városi Önkormányzat")).toBe("mór");
    expect(normName("MÓR VÁROSI ÖNKORMÁNYZAT")).toBe("mór");
    expect(normName("Budapest Főváros Önkormányzata")).toBe("budapest");
    expect(normName("Szigetvár Város Önkormányzata")).toBe("szigetvár");
    expect(normName("Hódmezővásárhely Megyei Jogú Város Önkormányzata")).toBe("hódmezővásárhely");
  });
  it("irányítószám → település; Budapest egyben", () => {
    expect(citiesForZip("8060")).toEqual(["Mór"]);
    expect(citiesForZip("7900")).toContain("Szigetvár");
    expect(citiesForZip("1051")).toEqual(["Budapest"]);
    expect(zipFromAddress("8060 Mór, Deák Ferenc u. 1.")).toBe("8060");
  });
  it("letöltés előtt nincs szabály (v6.2.0: nincs beépített település); cím alapján székhely", () => {
    expect(ruleFor("Mór", null)).toBeNull();
    expect(companyHipaSites({ address: "8060 Mór, Fő u. 2.", settings: {} })).toEqual({ sites: [{ zip: "8060", city: "Mór", role: "seat", share: 1 }], fromAddress: true });
  });
});
