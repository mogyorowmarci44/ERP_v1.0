import { strToU8, zipSync } from "fflate";
import { requireCompany } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { isDate, today } from "@/lib/dates";
import { vatZip } from "@/lib/vat-return-data";
import { payrollZipFiles } from "@/lib/payroll-2608-data";

export const dynamic = "force-dynamic";

/** ÁNYK Export ZIP: ?kind=vat (ÁFA önellenőrzés / eredeti) vagy ?kind=payroll (2608, be nem küldött hónapok). */
export async function GET(req: Request, { params }: { params: Promise<{ cid: string }> }) {
  const cid = Number((await params).cid);
  const { company } = await requireCompany(cid, { module: "filings" });
  await audit({ action: "export.file", companyId: cid, target: new URL(req.url).pathname.slice(0, 255) }); // v6.0.0
  const sp = new URL(req.url).searchParams;
  const date = isDate(sp.get("date")) ? sp.get("date")! : today();
  const slug = company.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  let zip: Uint8Array, name: string;
  if (sp.get("kind") === "payroll") {
    try {
      const r = await payrollZipFiles(cid);
      const files: Record<string, Uint8Array> = { "00_osszesito.csv": strToU8("﻿" + r.csv) };
      for (const [k, v] of Object.entries(r.files)) files[k] = strToU8(v);
      zip = zipSync(files);
    } catch (e) {
      return new Response(e instanceof Error ? e.message : String(e), { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    name = `${slug}_2608_${date}.zip`;
  } else {
    zip = (await vatZip(cid, date, sp.get("place"))).zip;
    name = `${slug}_AFA_onellenorzes_${date}.zip`;
  }
  return new Response(new Uint8Array(zip), {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store", "Content-Length": String(zip.byteLength) },
  });
}
