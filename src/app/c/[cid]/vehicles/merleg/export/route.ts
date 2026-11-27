import { requireCompany } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { buildKeszletMerlegWorkbook } from "@/lib/keszlet-merleg";
import { periodOf } from "../period";

export const dynamic = "force-dynamic";

/** KészletMérleg Excel (készlet + eladott): /c/:cid/vehicles/merleg/export?p=…&g=… */
export async function GET(req: Request, { params }: { params: Promise<{ cid: string }> }) {
  const cid = Number((await params).cid);
  const { company } = await requireCompany(cid, { module: "vehicles" });
  await audit({ action: "export.file", companyId: cid, target: new URL(req.url).pathname.slice(0, 255) }); // v6.0.0
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const per = periodOf(sp);
  const g = (["model", "origin", "month"].includes(sp.g) ? sp.g : "none") as "none" | "model" | "origin" | "month";
  const { buffer } = await buildKeszletMerlegWorkbook(cid, { from: per.from, to: per.to, groupBy: g });
  const slug = company.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const buf = new Uint8Array(buffer as ArrayBuffer);
  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${slug}_KeszletMerleg_${per.from}_${per.to}.xlsx"`,
      "Cache-Control": "no-store",
      "Content-Length": String(buf.byteLength),
    },
  });
}
