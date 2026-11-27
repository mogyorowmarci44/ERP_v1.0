import { describe, expect, it } from "vitest";
import { accessOf, limitError, stateFromStripe } from "../src/lib/billing-calc";

const NOW = new Date("2026-11-27T10:00:00Z");
const d = (days: number) => new Date(NOW.getTime() + days * 86_400_000);

describe("előfizetés (v6.8.0)", () => {
  it("próbaidő: figyelmeztet 5 nappal előtte, lejárat után csak olvasható", () => {
    expect(accessOf({ subStatus: "trialing", trialEndsAt: d(10), currentPeriodEnd: null }, NOW)).toMatchObject({ writable: true, warn: false, daysLeft: 10 });
    expect(accessOf({ subStatus: "trialing", trialEndsAt: d(3), currentPeriodEnd: null }, NOW)).toMatchObject({ writable: true, warn: true });
    expect(accessOf({ subStatus: "trialing", trialEndsAt: d(-1), currentPeriodEnd: null }, NOW)).toMatchObject({ writable: false });
  });

  it("aktív, díjmentes, lemondott", () => {
    expect(accessOf({ subStatus: "active", trialEndsAt: null, currentPeriodEnd: d(20) }, NOW).writable).toBe(true);
    expect(accessOf({ subStatus: "active", trialEndsAt: null, currentPeriodEnd: d(-3) }, NOW).writable).toBe(false);
    expect(accessOf({ subStatus: "comped", trialEndsAt: null, currentPeriodEnd: null }, NOW).writable).toBe(true);
    expect(accessOf({ subStatus: "canceled", trialEndsAt: null, currentPeriodEnd: null }, NOW).writable).toBe(false);
  });

  it("elmaradt fizetés: 7 nap türelmi idő", () => {
    expect(accessOf({ subStatus: "past_due", trialEndsAt: null, currentPeriodEnd: null, pastDueSince: d(-2) }, NOW)).toMatchObject({ writable: true, daysLeft: 5, warn: true });
    expect(accessOf({ subStatus: "past_due", trialEndsAt: null, currentPeriodEnd: null, pastDueSince: d(-8) }, NOW).writable).toBe(false);
  });

  it("Stripe előfizetés leképezése (az időszak vége a tételen)", () => {
    const s = stateFromStripe({ status: "active", cancel_at_period_end: true, items: { data: [{ current_period_end: 1_800_000_000, price: { id: "price_1" } }] } });
    expect(s).toMatchObject({ subStatus: "active", priceId: "price_1", cancelAtPeriodEnd: true });
    expect(s.currentPeriodEnd?.getTime()).toBe(1_800_000_000_000);
    expect(stateFromStripe({ status: "unpaid" }).subStatus).toBe("past_due");
    expect(stateFromStripe({ status: "incomplete_expired" }).subStatus).toBe("canceled");
  });

  it("korlátok", () => {
    expect(limitError("companies", 2, 3)).toBeNull();
    expect(limitError("companies", 3, 3)).toMatch(/legfeljebb 3 céget/);
    expect(limitError("users", 10, null)).toBeNull();
  });
});
