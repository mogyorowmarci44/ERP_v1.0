import { describe, expect, it, vi } from "vitest";
vi.mock("@/db", () => ({ db: {}, schema: { companyMembers: {} } }));
import { completeness, roleLabel } from "@/lib/company-members";

const base = { birthPlace: null, birthDate: null, motherName: null, address: null, taxId: null, sharePct: null, startDate: null, partnerId: null, isMember: true };
describe("v4.5.0 – tagok és tisztségviselők", () => {
  it("tagnál 8 adat kell az okiratokhoz, ügyvezetőnél (nem tag) 6", () => {
    expect(completeness(base)).toMatchObject({ done: 0, total: 8 });
    expect(completeness({ ...base, isMember: false }).total).toBe(6);
    const full = { ...base, birthPlace: "Mór", birthDate: "1990-01-01", motherName: "X Y", address: "Mór", taxId: "8123456789", sharePct: 50, startDate: "2025-05-01", partnerId: 1 };
    expect(completeness(full)).toMatchObject({ done: 8, total: 8, missing: [] });
  });
  it("szerep felirat: tag és ügyvezető egyszerre is", () => {
    expect(roleLabel({ isMember: true, isCeo: true })).toBe("tag, ügyvezető");
    expect(roleLabel({ isMember: true, isCeo: false })).toBe("tag");
  });
});
