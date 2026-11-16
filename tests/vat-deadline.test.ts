import { describe, expect, it } from "vitest";
import { nextVatDeadline } from "@/lib/vat-deadline";

describe("nextVatDeadline", () => {
  it("havi: tárgyhó 20-a, utána a következő hónap 20-a", () => {
    expect(nextVatDeadline("monthly", "2026-11-16")).toBe("2026-11-20");
    expect(nextVatDeadline("monthly", "2026-11-21")).toBe("2026-12-20");
    expect(nextVatDeadline("monthly", "2026-12-21")).toBe("2027-01-20");
  });
  it("negyedéves: jan/ápr/júl/okt 20-a", () => {
    expect(nextVatDeadline("quarterly", "2026-11-16")).toBe("2027-01-20");
    expect(nextVatDeadline("quarterly", "2026-04-20")).toBe("2026-04-20");
  });
  it("éves: február 25.", () => {
    expect(nextVatDeadline("yearly", "2026-02-10")).toBe("2026-02-25");
    expect(nextVatDeadline("yearly", "2026-11-16")).toBe("2027-02-25");
  });
});
