import { describe, it, expect } from "vitest";
import { parseCatalogRow, parseCsv, parseGearbox, parseKgRange, variantCoversYear } from "@/lib/car-catalog-parse";

const csv = '﻿"autodata_id";"Brand";"Model"\r\n' +
  '"34646";"Suzuki";"Vitara";"Vitara IV (facelift 2018)";"1.4 BOOSTERJET (140 Hp) ALLGRIP";"October, 2018";"April, 2020";"Internal Combustion engine";"SUV (Sport Utility Vehicle)";"Petrol (Gasoline)";"140 Hp @ 5500 rpm.";"1373 cm3";"K14C-DITC";"All wheel drive (4x4)";"6 gears, manual transmission";"1195-1240 kg";"1730 kg";"";""\r\n' +
  '"41987";"Volkswagen";"Caddy";"Caddy Maxi Cargo V";"2.0 TDI (122 Hp) DSG";"2020";"";"Internal Combustion engine";"Minivan";"Diesel";"122 Hp @ 2750-4250 rpm.";"1968 cm3";"EA288 evo / DTRC";"Front wheel drive";"7 gears, automatic transmission DSG";"1546 kg";"2350 kg";"";""\r\n';

describe("v4.5.3 – típuskatalógus értelmezés", () => {
  const rows = parseCsv(csv);
  it("CSV: BOM, idézőjelek, CRLF", () => {
    expect(rows).toHaveLength(3);
    expect(rows[1][1]).toBe("Suzuki");
  });
  it("Suzuki Vitara: évjárat-intervallum, kW, váltó, tömegtartomány", () => {
    const r = parseCatalogRow(rows[1])!;
    expect(r).toMatchObject({ sourceId: 34646, yearFrom: 2018, monthFrom: 10, yearTo: 2020, monthTo: 4, fuel: "benzin", powertrain: "ice",
      displacementCc: 1373, powerHp: 140, powerKw: 103, drive: "awd", gears: 6, gearbox: "manuális", kerbMinKg: 1195, kerbMaxKg: 1240, grossKg: 1730 });
  });
  it("VW Caddy: gyártásban (year_to null), DSG, dízel", () => {
    const r = parseCatalogRow(rows[2])!;
    expect(r).toMatchObject({ yearFrom: 2020, yearTo: null, fuel: "dízel", gearbox: "DSG", gears: 7, kerbMaxKg: 1546, grossKg: 2350, drive: "fwd" });
    expect(variantCoversYear(r, 2024, 2026)).toBe(true);
    expect(variantCoversYear(r, 2019, 2026)).toBe(false);
  });
  it("segédek", () => {
    expect(parseKgRange("1 195 - 1 240 kg")).toEqual([1195, 1240]);
    expect(parseGearbox("CVT").gearbox).toBe("CVT");
    expect(parseGearbox("8 gears, automatic transmission").gearbox).toBe("automata");
  });
});
