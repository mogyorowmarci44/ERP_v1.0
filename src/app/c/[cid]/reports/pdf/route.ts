import { requireCompany } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { isDate, monthEnd, today, yearStart, fmtDate } from "@/lib/dates";
import { buildReportPdf, type PdfKind } from "@/lib/pdf-reports";

export const dynamic = "force-dynamic";

/** v7.4.0 – Nyomtatható PDF: /c/:cid/reports/pdf?type=tb|pnl|bs|open&from=…&to=… */
export async function GET(req: Request, { params }: { params: Promise<{ cid: string }> }) {
  const cid = Number((await params).cid);
  const { company } = await requireCompany(cid);
  const sp = new URL(req.url).searchParams;
  const type = (["tb", "pnl", "bs", "open"] as const).find((t) => t === sp.get("type")) as PdfKind | undefined;
  if (!type) return new Response("Ismeretlen kimutatás.", { status: 400 });
  const from = isDate(sp.get("from")) ? sp.get("from")! : yearStart();
  const to = isDate(sp.get("to")) ? sp.get("to")! : monthEnd(today());
  if (from > to) return new Response("A kezdő dátum a záró után van.", { status: 400 });
  await audit({ action: "export.file", companyId: cid, target: new URL(req.url).pathname.slice(0, 255), details: { type, from, to } });
  const { bytes, name } = await buildReportPdf(cid, company, type, from, to);
  const slug = company.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${slug}_${name}_${type === "open" ? fmtDate(to).replace(/\./g, "") : `${from}_${to}`}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
