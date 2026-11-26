import { requireCompany } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { buildAnykXml } from "@/lib/anyk";
import { getFiling } from "@/lib/filings";

export const dynamic = "force-dynamic";

/** ÁNYK-ba importálható XML egy nyilvántartott bevallás-változatból: /c/:cid/filings/:id/xml */
export async function GET(_req: Request, { params }: { params: Promise<{ cid: string; id: string }> }) {
  const p = await params;
  const cid = Number(p.cid);
  const { company } = await requireCompany(cid);
  await audit({ action: "export.file", companyId: cid, target: new URL(_req.url).pathname.slice(0, 255) }); // v6.0.0
  const f = await getFiling(cid, Number(p.id));
  if (!f) return new Response("Nincs ilyen bevallás.", { status: 404 });
  const xml = buildAnykXml({
    taxNumber: company.taxNumber ?? "", taxpayerName: company.name, from: f.periodFrom, to: f.periodTo,
    sheets: f.sheets, programVersion: "mogyorosi.erp",
  });
  const slug = company.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const name = `${slug}_${f.form}_${f.periodFrom.slice(0, 7)}_${f.kind}_${f.id}.xml`;
  const body = new TextEncoder().encode(xml);
  return new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
      "Content-Length": String(body.byteLength),
    },
  });
}
