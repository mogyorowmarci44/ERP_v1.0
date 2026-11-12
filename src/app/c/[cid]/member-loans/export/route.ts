import { requireCompany } from "@/lib/auth";
import { buildMemberLoanWorkbook } from "@/lib/member-loan-export";
import { isDate, today } from "@/lib/dates";

export const dynamic = "force-dynamic";

/** Tagi kölcsön Excel: /c/:cid/member-loans/export?date=… */
export async function GET(req: Request, { params }: { params: Promise<{ cid: string }> }) {
  const cid = Number((await params).cid);
  const { company } = await requireCompany(cid);
  const sp = new URL(req.url).searchParams;
  const asOf = isDate(sp.get("date")) ? sp.get("date")! : today();
  const { buffer } = await buildMemberLoanWorkbook(cid, asOf);
  const slug = company.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${slug}_tagi_kolcson_${asOf}.xlsx"`,
      "Cache-Control": "no-store",
      "Content-Length": String(buffer.byteLength),
    },
  });
}
