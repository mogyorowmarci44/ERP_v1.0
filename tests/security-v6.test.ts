import { describe, expect, it } from "vitest";
import { ACCOUNT_LIMIT, IP_LIMIT, afterFailure, ipFromForwarded, lockedMinutes } from "../src/lib/throttle-calc";
import { actionLabel, formDetails, redirectOutcome, resultOutcome } from "../src/lib/audit-calc";
import { canPurge, daysUntilPurge, exportFresh, purgeAvailableFrom } from "../src/lib/archive-calc";

const T0 = new Date("2026-11-26T10:00:00Z");
const plusMin = (d: Date, m: number) => new Date(d.getTime() + m * 60000);

describe("belépésvédelem", () => {
  it("5. hibás jelszó után 15 perc zárolás", () => {
    let st = null as ReturnType<typeof afterFailure> | null;
    for (let i = 1; i <= 4; i++) {
      st = afterFailure(st, plusMin(T0, i), ACCOUNT_LIMIT);
      expect(st.locked).toBe(false);
      expect(st.failures).toBe(i);
    }
    st = afterFailure(st, plusMin(T0, 5), ACCOUNT_LIMIT);
    expect(st.locked).toBe(true);
    expect(lockedMinutes(st, plusMin(T0, 5))).toBe(15);
    expect(lockedMinutes(st, plusMin(T0, 19))).toBe(1);
    expect(lockedMinutes(st, plusMin(T0, 20))).toBe(0);
  });

  it("lejárt ablak után újraindul a számlálás", () => {
    const st = afterFailure({ failures: 4, windowStart: T0, lockedUntil: null }, plusMin(T0, 16), ACCOUNT_LIMIT);
    expect(st).toMatchObject({ failures: 1, locked: false });
  });

  it("IP-korlát magasabb, hosszabb zárolással", () => {
    const st = afterFailure({ failures: IP_LIMIT.max - 1, windowStart: T0, lockedUntil: null }, plusMin(T0, 1), IP_LIMIT);
    expect(st.locked).toBe(true);
    expect(lockedMinutes(st, plusMin(T0, 1))).toBe(30);
  });

  it("IP a proxy fejlécéből", () => {
    expect(ipFromForwarded("203.0.113.7, 10.0.0.1")).toBe("203.0.113.7");
    expect(ipFromForwarded(null, "198.51.100.2")).toBe("198.51.100.2");
    expect(ipFromForwarded("", "")).toBe("ismeretlen");
  });
});

describe("tevékenységnapló", () => {
  it("az átirányítás céljából olvassa ki az eredményt", () => {
    expect(redirectOutcome("NEXT_REDIRECT;replace;/c/1/invoices?ok=Sz%C3%A1mla%20mentve.;303;")).toEqual({ ok: true, message: "Számla mentve." });
    expect(redirectOutcome("NEXT_REDIRECT;push;/c/1/invoices?error=Hib%C3%A1s%20d%C3%A1tum;303;")).toEqual({ ok: false, message: "Hibás dátum" });
    expect(redirectOutcome("NEXT_REDIRECT;replace;/c/1;307;")).toEqual({ ok: true });
    expect(redirectOutcome("NEXT_NOT_FOUND")).toBeNull();
    expect(redirectOutcome(undefined)).toBeNull();
  });

  it("visszaadott { error } eredmény", () => {
    expect(resultOutcome({ error: "Nem egyezik" })).toEqual({ ok: false, message: "Nem egyezik" });
    expect(resultOutcome({ id: 5 })).toEqual({ ok: true });
    expect(resultOutcome(undefined)).toEqual({ ok: true });
  });

  it("az űrlapból csak azonosítókat naplóz – jelszót, összeget, fájlt nem", () => {
    const fd = new FormData();
    fd.set("cid", "3"); fd.set("id", "42"); fd.set("invoiceId", "7"); fd.set("password", "titok123456");
    fd.set("amount", "1000000"); fd.set("code", "123456"); fd.set("period", "2026-10"); fd.set("note", "hosszú megjegyzés");
    expect(formDetails(fd)).toEqual({ cid: "3", id: "42", invoiceId: "7", period: "2026-10" });
    expect(formDetails(null)).toEqual({});
  });

  it("magyar megnevezés, ismeretlen műveletnél a függvénynévből", () => {
    expect(actionLabel("postInvoiceAction")).toBe("Számla könyvelése");
    expect(actionLabel("saveThemeAction")).toBe("save theme");
  });
});

describe("archiválás és végleges törlés", () => {
  it("archiválás csak 24 órán belüli teljes export után", () => {
    expect(exportFresh(null, T0)).toBe(false);
    expect(exportFresh(plusMin(T0, -60), T0)).toBe(true);
    expect(exportFresh(plusMin(T0, -24 * 60 - 1), T0)).toBe(false);
    expect(exportFresh(plusMin(T0, 5), T0)).toBe(false); // jövőbeli időpont nem fogadható el
  });

  it("végleges törlés csak 30 nap türelmi idő után", () => {
    expect(purgeAvailableFrom(T0).toISOString()).toBe("2026-12-26T10:00:00.000Z");
    expect(canPurge(T0, plusMin(T0, 29 * 24 * 60))).toBe(false);
    expect(daysUntilPurge(T0, plusMin(T0, 29 * 24 * 60))).toBe(1);
    expect(canPurge(T0, plusMin(T0, 30 * 24 * 60))).toBe(true);
    expect(canPurge(null, T0)).toBe(false);
  });
});
