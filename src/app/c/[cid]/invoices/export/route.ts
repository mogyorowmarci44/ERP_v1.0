import { requireCompany } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { buildInvoiceWorkbook } from "@/lib/invoice-export";
import { isDate, yearStart, monthEnd, today } from "@/lib/dates";

export const dynamic = "force-dynamic";

/** Nyomtatható Excel: /c/:cid/invoices/export?from=…&to=…&dir=in|out|all */
export async function GET(req: Request, { params }: { params: Promise<{ cid: string }> }) {
  const cid = Number((await params).cid);
  const { company } = await requireCompany(cid);
  await audit({ action: "export.file", companyId: cid, target: new URL(req.url).pathname.slice(0, 255) }); // v6.0.0
  const sp = new URL(req.url).searchParams;
  const from = isDate(sp.get("from")) ? sp.get("from")! : yearStart();
  const to = isDate(sp.get("to")) ? sp.get("to")! : monthEnd(today());
  const d = sp.get("dir");
  const dir = d === "in" || d === "out" ? d : undefined;
  const { buffer } = await buildInvoiceWorkbook(cid, { from, to, dir });
  const slug = company.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const name = `${slug}_szamlak_${from}_${to}${dir ? `_${dir === "in" ? "szallitoi" : "vevo"}` : ""}.xlsx`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
      "Content-Length": String(buffer.byteLength),
    },
  });
}
