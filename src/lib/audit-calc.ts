/**
 * v6.0.0 – Tevékenységnapló: tiszta segédfüggvények (tesztelhetők).
 */

/** A Next.js átirányítási hibájának céljából kiolvassa, sikeres volt-e a művelet (?error=… → hiba). */
export function redirectOutcome(digest: unknown): { ok: boolean; message?: string } | null {
  if (typeof digest !== "string" || !digest.startsWith("NEXT_REDIRECT")) return null;
  const url = digest.split(";")[2] ?? "";
  const q = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
  const sp = new URLSearchParams(q);
  const err = sp.get("error");
  if (err !== null) return { ok: false, message: err.slice(0, 300) };
  const ok = sp.get("ok");
  return ok !== null ? { ok: true, message: ok.slice(0, 300) } : { ok: true };
}

/** A visszatérési értékből ({ error } alakú eredmény) olvassa ki a hibát. */
export function resultOutcome(r: unknown): { ok: boolean; message?: string } {
  if (r && typeof r === "object" && "error" in r && (r as { error?: unknown }).error)
    return { ok: false, message: String((r as { error: unknown }).error).slice(0, 300) };
  return { ok: true };
}

/** Az űrlapból csak az azonosítókat és a néhány beszédes mezőt naplózzuk – összegeket, jelszavakat soha. */
const KEEP = /^(id|[a-z]+Id|cid|companyId|period|year|month|date|role|purpose|kind|status|fmt|from|to)$/;
const NEVER = /pass|secret|token|code|json|file|logo/i;
export function formDetails(fd: FormData | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fd || typeof fd.forEach !== "function") return out;
  fd.forEach((v, k) => {
    if (typeof v !== "string" || NEVER.test(k) || !KEEP.test(k) || k.startsWith("$ACTION")) return;
    if (v.length > 40) return;
    out[k] = v;
  });
  return out;
}

/** A naplóban megjelenő magyar megnevezés. */
export const ACTION_LABEL: Record<string, string> = {
  "login.ok": "Belépés",
  "login.fail": "Sikertelen belépés",
  "login.locked": "Belépés zárolva",
  "mfa.fail": "Hibás 2FA-kód",
  "mfa.setup": "2FA beállítva",
  logout: "Kilépés",
  "password.change": "Jelszócsere",
  "password.resetRequest": "Jelszó-visszaállítás kérése",
  "password.reset": "Jelszó visszaállítva",
  "invite.create": "Meghívó létrehozva",
  "invite.accept": "Meghívó elfogadva",
  "access.set": "Hozzáférés módosítása",
  "mfa.reset": "2FA visszaállítása",
  "user.logoutEverywhere": "Kiléptetés minden eszközről",
  "org.mfaRequired": "2FA kötelezőség módosítása",
  "org.create": "Ügyfélfiók létrehozása",
  "support.grant": "Támogatói hozzáférés",
  "company.create": "Cég létrehozása",
  "company.archive": "Cég archiválása",
  "company.restore": "Cég visszaállítása archívumból",
  "company.purge": "Cég végleges törlése",
  "export.data": "Adatexport letöltése",
  "backup.download": "Teljes mentés letöltése",
  "backup.restore": "Visszaállítás mentésből",
  "terms.accept": "ÁSZF és adatkezelési tájékoztató elfogadása",
  "vendor.update": "Üzemeltetői adatok módosítása",
  "legalParam.set": "Jogszabályi paraméter rögzítése",
  "legalParam.delete": "Jogszabályi paraméter törlése",
  saveMemberTbAccountAction: "Bér: járulék-költségszámla",
  "export.file": "Fájl letöltése",
  saveInvoiceAction: "Számla mentése",
  postInvoiceAction: "Számla könyvelése",
  cancelInvoiceAction: "Számla sztornózása",
  voidInvoiceAction: "Számla rontottnak jelölése",
  payInvoiceAction: "Kiegyenlítés rögzítése",
  reopenInvoiceAction: "Számla visszanyitása",
  editPaymentAction: "Kiegyenlítés módosítása",
  reversePaymentAction: "Kiegyenlítés visszavonása",
  manualEntryAction: "Vegyes tétel könyvelése",
  reverseEntryAction: "Tétel sztornózása",
  updateManualEntryAction: "Vegyes tétel módosítása",
  updateEntryMetaAction: "Tétel adatainak módosítása",
  closeVatAction: "ÁFA-időszak zárása",
  reopenVatAction: "ÁFA-időszak visszanyitása",
  lockPeriodAction: "Időszak zárása / nyitása",
  updateCompanyAction: "Cégadatok módosítása",
  importBundleAction: "Adatimport",
  deltaImportAction: "Kiegészítő import",
  wipeCompanyAction: "Cégadatok ürítése",
  savePartnerAction: "Partner mentése",
  saveVehicleAction: "Gépkocsi mentése",
  saveAccountAction: "Főkönyvi számla mentése",
  saveModulesAction: "Modulok kapcsolása",
  saveItemAction: "Cikk mentése",
  stockMoveAction: "Kézi készletmozgás",
  deleteStockMoveAction: "Készletmozgás törlése",
  postCogsAction: "ELÁBÉ könyvelése",
};

/** Megnevezés: a táblából, különben a függvénynévből („saveThemeAction” → „save theme”). */
export function actionLabel(a: string): string {
  if (ACTION_LABEL[a]) return ACTION_LABEL[a];
  return a.replace(/Action$/, "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}
