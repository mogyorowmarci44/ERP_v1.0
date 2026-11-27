import { requireCompany } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { isDate, today } from "@/lib/dates";
import { vatZip } from "@/lib/vat-return-data";

export const dynamic = "force-dynamic";

/** Az összes eltérő ÁFA-időszak önellenőrző / eredeti XML-je egy ZIP-ben: /c/:cid/filings/vat/zip?date=ÉÉÉÉ-HH-NN */
export async function GET(req: Request, { params }: { params: Promise<{ cid: string }> }) {
  const cid = Number((await params).cid);
  const { company } = await requireCompany(cid, { module: "filings" });
  await audit({ action: "export.file", companyId: cid, target: new URL(req.url).pathname.slice(0, 255) }); // v6.0.0
  const sp = new URL(req.url).searchParams;
  const date = isDate(sp.get("date")) ? sp.get("date")! : today();
  const { zip } = await vatZip(cid, date, sp.get("place"));
  const slug = company.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return new Response(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${slug}_AFA_onellenorzes_${date}.zip"`,
      "Cache-Control": "no-store",
      "Content-Length": String(zip.byteLength),
    },
  });
}
