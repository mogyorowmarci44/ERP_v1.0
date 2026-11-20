import { requireCompany } from "@/lib/auth";
import { isDate, today } from "@/lib/dates";
import { vatXml, xmlName } from "@/lib/vat-return-data";

export const dynamic = "force-dynamic";

/** Egy ÁFA-időszak ÁNYK-XML-je az ERP adataiból (önellenőrzés vagy eredeti): /c/:cid/filings/vat/:period/xml?date=… */
export async function GET(req: Request, { params }: { params: Promise<{ cid: string; period: string }> }) {
  const p = await params;
  const cid = Number(p.cid);
  await requireCompany(cid);
  if (!/^\d{4}-\d{2}$/.test(p.period)) return new Response("Hibás időszak.", { status: 400 });
  const sp = new URL(req.url).searchParams;
  const date = isDate(sp.get("date")) ? sp.get("date")! : today();
  const { xml, row, company } = await vatXml(cid, p.period, date, sp.get("place"));
  const body = new TextEncoder().encode(xml);
  return new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="${xmlName(company.name, row)}"`,
      "Cache-Control": "no-store",
      "Content-Length": String(body.byteLength),
    },
  });
}
