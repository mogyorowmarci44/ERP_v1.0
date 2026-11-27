import { requireCompany } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { isDate, today } from "@/lib/dates";
import { vatXml, xmlName } from "@/lib/vat-return-data";

export const dynamic = "force-dynamic";

/** Egy ÁFA-időszak ÁNYK-ba importálható XML-je (?format=enyk: kísérleti ÁNYK-mentés) az ERP adataiból (önellenőrzés vagy eredeti): /c/:cid/filings/vat/:period/xml?date=… */
export async function GET(req: Request, { params }: { params: Promise<{ cid: string; period: string }> }) {
  const p = await params;
  const cid = Number(p.cid);
  await requireCompany(cid, { module: "filings" });
  await audit({ action: "export.file", companyId: cid, target: new URL(req.url).pathname.slice(0, 255) }); // v6.0.0
  if (!/^\d{4}-\d{2}$/.test(p.period)) return new Response("Hibás időszak.", { status: 400 });
  const sp = new URL(req.url).searchParams;
  const date = isDate(sp.get("date")) ? sp.get("date")! : today();
  const format = sp.get("format") === "enyk" ? "enyk" : "xml";
  const { xml, row, company } = await vatXml(cid, p.period, date, sp.get("place"), format);
  const body = new TextEncoder().encode(xml);
  return new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="${xmlName(company.name, row, format)}"`,
      "Cache-Control": "no-store",
      "Content-Length": String(body.byteLength),
    },
  });
}
