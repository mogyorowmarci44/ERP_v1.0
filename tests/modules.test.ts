import { describe, expect, it } from "vitest";
import { MODULE_KEYS, moduleDefault, moduleOn, modulesFromForm } from "../src/lib/modules";
import { isCarDealer } from "../src/lib/activity";

describe("modulkapcsolók (v6.2.0)", () => {
  it("profil szerinti alapértelmezés", () => {
    expect(moduleOn({ activityProfile: "car_dealer", settings: {} }, "vehicles")).toBe(true);
    expect(moduleOn({ activityProfile: "general", settings: {} }, "vehicles")).toBe(false);
    expect(moduleOn({ activityProfile: "trade", settings: {} }, "inventory")).toBe(true);
    expect(moduleOn({ activityProfile: "services", settings: {} }, "inventory")).toBe(false);
    for (const p of ["car_dealer", "general", "services", "trade"]) expect(moduleDefault(p, "payroll")).toBe(true);
  });

  it("a kézi beállítás felülírja a profilt; a gépkocsi-modul az isCarDealer-t is kapcsolja", () => {
    const c = { activityProfile: "car_dealer", settings: { modules: { vehicles: false, payroll: false } } };
    expect(moduleOn(c, "vehicles")).toBe(false);
    expect(moduleOn(c, "payroll")).toBe(false);
    expect(isCarDealer(c)).toBe(false);
    expect(isCarDealer({ activityProfile: "general", settings: { modules: { vehicles: true } } })).toBe(true);
  });

  it("csak az eltéréseket tárolja", () => {
    const allOn = modulesFromForm("general", () => true);
    expect(allOn).toEqual({ vehicles: true, inventory: true });
    expect(modulesFromForm("car_dealer", (k) => moduleDefault("car_dealer", k) && k !== "payroll")).toEqual({ payroll: false });
    expect(Object.keys(modulesFromForm("trade", (k) => moduleDefault("trade", k)))).toHaveLength(0);
    expect(MODULE_KEYS).toContain("forecast");
  });
});
