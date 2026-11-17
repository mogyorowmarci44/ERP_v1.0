import { describe, expect, it } from "vitest";
import { decodeVin, normalizeVin, sameMake, vinModelYear } from "@/lib/vin";

describe("VIN", () => {
  it("normalizál, és elutasítja a hibásat", () => {
    expect(normalizeVin(" wvwzzz1kz8w123456 ")).toBe("WVWZZZ1KZ8W123456");
    expect(normalizeVin("WVWZZZ1KZ8W12345")).toBeNull(); // 16 karakter
    expect(normalizeVin("WVWZZZ1KZ8O123456")).toBeNull(); // O betű
  });
  it("gyártó és modellév", () => {
    expect(decodeVin("WVWZZZ1KZ8W123456", 2027)).toEqual({ vin: "WVWZZZ1KZ8W123456", make: "Volkswagen", year: 2008 });
    expect(decodeVin("WBA8E9C50GK123456", 2027)?.year).toBe(2016);
    expect(decodeVin("TMBJJ7NE0L0123456", 2027)?.make).toBe("Škoda");
    expect(vinModelYear("WAUZZZ8V0RA123456", 2027)).toBe(2024);
    expect(vinModelYear("WAUZZZ8V0ZA123456", 2027)).toBeNull(); // Z nem évkód
  });
  it("gyártmány egyezés", () => {
    expect(sameMake("VW", "Volkswagen")).toBe(true);
    expect(sameMake("Skoda", "Škoda")).toBe(true);
    expect(sameMake("Mercedes", "Mercedes-Benz")).toBe(true);
    expect(sameMake("Audi", "Volkswagen")).toBe(false);
  });
});
