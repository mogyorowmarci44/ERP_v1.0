import { requireCompany } from "@/lib/auth";
import { buildExport, buildExportWorkbook } from "@/lib/data-export";
import { firstEntryDate } from "@/lib/forecast-data";
import { isDate, today } from "@/lib/dates";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** Adatexport: /c/:cid/import/export?from=…&to=…&fmt=json|xlsx (alapból: az első tételtől máig, JSON). */
export async function GET(req: Request, { params }: { params: Promise<{ cid: string }> }) {
  const cid = Number((await params).cid);
  const { company } = await requireCompany(cid);
  const sp = new URL(req.url).searchParams;
  const from = isDate(sp.get("from")) ? sp.get("from")! : (await firstEntryDate(cid)) ?? `${today().slice(0, 4)}-01-01`;
  const to = isDate(sp.get("to")) ? sp.get("to")! : today();
  const data = await buildExport(cid, from, to);
  // v6.0.0 – a teljes (első tételtől máig) export az archiválás előfeltétele; minden export naplózva
  const full = !isDate(sp.get("from")) && !isDate(sp.get("to"));
  if (full) await db.update(schema.companies).set({ lastFullExportAt: new Date() }).where(eq(schema.companies.id, cid));
  await audit({ action: "export.data", companyId: cid, details: { from, to, fmt: sp.get("fmt") === "xlsx" ? "xlsx" : "json", full } });
  const slug = company.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const base = `${slug}_export_${from}_${to}`;
  if (sp.get("fmt") === "xlsx") {
    const buf = await buildExportWorkbook(data);
    return new Response(new Uint8Array(buf), {
      headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${base}.xlsx"`, "Cache-Control": "no-store" },
    });
  }
  return new Response(JSON.stringify(data, null, 1), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${base}.json"`, "Cache-Control": "no-store" },
  });
}
