import { describe, expect, it } from "vitest";
import { cogsDeductionCap, hipaBase, hipaTax, taoCalc, taoSeries, taxReturnDue, type HipaRule } from "@/lib/corp-tax";

const mor: HipaRule = { name: "Mór", rate: 0.02, exemptBelow: 2_500_000, exemptInclusive: false };
const ajka: HipaRule = { name: "Ajka", rate: 0.02, exemptBelow: 500_000, exemptInclusive: true };

describe("HIPA-alap", () => {
  it("nettó árbevétel − ELÁBÉ − közvetített − anyag − alvállalkozó", () => {
    const b = hipaBase({ revenue: 40_000_000, cogs: 33_000_000, mediated: 1_000_000, materials: 500_000, subcontract: 300_000 });
    expect(b.base).toBe(5_200_000);
    expect(b.cogsCap).toBeNull();
  });
  it("500 M Ft felett az ELÁBÉ + közvetített sávosan vonható le", () => {
    expect(cogsDeductionCap(1_000_000_000)).toBe(500_000_000 + 500_000_000 * 0.85);
    const b = hipaBase({ revenue: 1_000_000_000, cogs: 990_000_000, mediated: 0, materials: 0 });
    expect(b.cogsDeducted).toBe(925_000_000);
    expect(b.base).toBe(75_000_000);
  });
});

describe("HIPA településenként", () => {
  it("Mór: 2,5 M Ft alatt mentes, felette a teljes alapra 2%", () => {
    expect(hipaTax(2_499_999, [{ name: "Mór", role: "seat", share: 1, rule: mor }]).total).toBe(0);
    expect(hipaTax(2_500_000, [{ name: "Mór", role: "seat", share: 1, rule: mor }]).total).toBe(50_000);
  });
  it("„nem haladja meg” → a határon még mentes", () => {
    expect(hipaTax(500_000, [{ name: "Ajka", role: "seat", share: 1, rule: ajka }]).total).toBe(0);
  });
  it("megosztás: a mentesség a vállalkozási szintű alaphoz kötött; ismeretlen település 2%", () => {
    const r = hipaTax(3_000_000, [
      { name: "Mór", role: "seat", share: 0.6, rule: mor },
      { name: "Ismeretlen", role: "site", share: 0.4, rule: null },
    ]);
    expect(r.lines.map((l) => l.base)).toEqual([1_800_000, 1_200_000]);
    expect(r.lines[0].exempt).toBe(false); // 3 M Ft vállalkozási szintű alap > 2,5 M
    expect(r.total).toBe(36_000 + 24_000);
  });
});

describe("TAO", () => {
  it("9%, elhatárolt veszteség legfeljebb az adóalap 50%-áig", () => {
    const r = taoCalc({ preTax: 10_000_000, losses: [{ year: "2025", amount: 8_000_000 }] });
    expect(r.lossUsed).toBe(5_000_000);
    expect(r.base).toBe(5_000_000);
    expect(r.tax).toBe(450_000);
    expect(r.lossesAfter).toEqual([{ year: "2025", amount: 3_000_000 }]);
  });
  it("veszteséges évben nincs adó, a veszteség továbbvihető", () => {
    const r = taoCalc({ preTax: -2_000_000, increases: 100_000 });
    expect(r.tax).toBe(0);
    expect(r.newLoss).toBe(1_900_000);
  });
  it("sorozat: a veszteség 5 év után lejár", () => {
    const s = taoSeries([
      { year: "2020", preTax: -1_000_000 },
      { year: "2025", preTax: 1_000_000 },
      { year: "2026", preTax: 1_000_000 },
    ]);
    expect(s[1].lossUsed).toBe(500_000); // 2025-ben még felhasználható (5. év)
    expect(s[2].lossUsed).toBe(0); // 2026-ban már nem (6. év)
    expect(s[2].tax).toBe(90_000);
  });
  it("bevallási határidő: az üzleti év végét követő 5. hónap utolsó napja", () => {
    expect(taxReturnDue("2026-12-31")).toBe("2027-05-31");
    expect(taxReturnDue("2027-06-30")).toBe("2027-11-30");
  });
});
