import { requireCompany } from "@/lib/auth";
import { templateXlsx } from "@/lib/onboarding";

/** v6.5.0 – Kitölthető minta-táblázatok (nyitómérleg, partnerek, számlatükör). */
export async function GET(req: Request, { params }: { params: Promise<{ cid: string }> }) {
  await requireCompany(Number((await params).cid));
  const kind = new URL(req.url).searchParams.get("kind");
  if (kind !== "opening" && kind !== "partners" && kind !== "accounts") return new Response("Ismeretlen sablon", { status: 400 });
  const name = { opening: "nyitomerleg", partners: "partnerek", accounts: "szamlatukor" }[kind];
  return new Response(new Uint8Array(await templateXlsx(kind)), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}_minta.xlsx"`,
    },
  });
}
