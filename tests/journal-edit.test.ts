import { describe, expect, it, vi } from "vitest";
vi.mock("@/db", () => ({ db: {}, schema: {} }));
import { canEditMeta } from "@/lib/journal-edit";

describe("canEditMeta", () => {
  it("kézi, nem sztornózott tétel szerkeszthető", () => {
    expect(canEditMeta({ sourceType: "manual", reversedById: null, reversalOfId: null })).toBe(true);
  });
  it("sztornózott vagy sztornó tétel nem", () => {
    expect(canEditMeta({ sourceType: "manual", reversedById: 5, reversalOfId: null })).toBe(false);
    expect(canEditMeta({ sourceType: "storno", reversedById: null, reversalOfId: 3 })).toBe(false);
  });
  it("számlából, rendezésből, tagi kölcsönből származó tétel nem", () => {
    for (const s of ["invoice", "payment", "member_loan", "member_loan_reval", null]) expect(canEditMeta({ sourceType: s, reversedById: null, reversalOfId: null })).toBe(false);
  });
});
