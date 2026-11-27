import { describe, it, expect } from "vitest";
import { moduleVisible } from "@/lib/modules";
import { ROLE_LABEL, isRole } from "@/lib/roles";

describe("v6.11.0 – modulonkénti jogosultság", () => {
  const c = { activityProfile: "general", settings: { modules: { inventory: true } } };
  it("a cégnél kikapcsolt modul senkinek sem látszik, az elrejtett csak annak, akinél el van rejtve", () => {
    expect(moduleVisible(c, [], "payroll")).toBe(true);
    expect(moduleVisible(c, ["payroll"], "payroll")).toBe(false);
    expect(moduleVisible(c, ["payroll"], "inventory")).toBe(true);
    expect(moduleVisible(c, null, "vehicles")).toBe(false);
  });
  it("szerepkörök", () => {
    expect(ROLE_LABEL.uploader).toBe("bizonylatfeltöltő");
    expect(isRole("uploader")).toBe(true);
    expect(isRole("admin")).toBe(false);
  });
});
