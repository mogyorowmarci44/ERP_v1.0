"use server";

import { revalidatePath } from "next/cache";
import { requireCompany } from "@/lib/auth";
import { runOrRedirect, str, optStr } from "@/lib/action-utils";
import { isDate } from "@/lib/dates";
import { parseSections, saveAnnualReport, type AnnualReportMeta } from "@/lib/annual-report";
import { withAudit } from "@/lib/audit";

/** Kiegészítő melléklet és beszámoló-fejléc mentése (évenként egy). */
export async function saveAnnualReportAction(fd: FormData) {
  return withAudit("saveAnnualReportAction", fd, () => saveAnnualReportActionImpl(fd));
}

async function saveAnnualReportActionImpl(fd: FormData) {
  const cid = Number(fd.get("cid"));
  const year = Number(fd.get("year"));
  const { user } = await requireCompany(cid, { write: true });
  await runOrRedirect(`/c/${cid}/reports/annual/edit?year=${year}`, async () => {
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error("Érvénytelen év.");
    const periodFrom = str(fd, "periodFrom");
    const periodTo = str(fd, "periodTo");
    if (!isDate(periodFrom) || !isDate(periodTo) || periodFrom > periodTo) throw new Error("Érvénytelen beszámolási időszak.");
    const preparedAt = optStr(fd, "preparedAt");
    if (preparedAt && !isDate(preparedAt)) throw new Error("Érvénytelen keltezés.");
    let filed: AnnualReportMeta["filed"] = null;
    const filedJson = str(fd, "filed");
    if (filedJson) {
      try {
        filed = JSON.parse(filedJson);
      } catch {
        throw new Error("A közzétett adatok mezője nem érvényes JSON.");
      }
    }
    const meta: AnnualReportMeta = {
      kind: str(fd, "kind") || "Egyszerűsített éves beszámoló",
      versionLabel: optStr(fd, "versionLabel"),
      periodFrom,
      periodTo,
      statNumber: optStr(fd, "statNumber"),
      preparedPlace: optStr(fd, "preparedPlace"),
      preparedAt,
      signer: optStr(fd, "signer"),
      signerTitle: optStr(fd, "signerTitle"),
      preparer: optStr(fd, "preparer"),
      preparerRegNo: optStr(fd, "preparerRegNo"),
      filed,
    };
    await saveAnnualReport(cid, year, meta, parseSections(String(fd.get("notes") ?? "")), user.id);
    revalidatePath(`/c/${cid}/reports/annual`);
    return `/c/${cid}/reports/annual?year=${year}&ok=${encodeURIComponent("Beszámoló mentve.")}`;
  });
}
