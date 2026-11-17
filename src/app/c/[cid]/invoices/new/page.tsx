import Link from "next/link";
import { requireCompany } from "@/lib/auth";
import { formOptions } from "@/lib/options";
import { InvoiceForm } from "@/components/InvoiceForm";
import { today } from "@/lib/dates";
import { lineDefaults } from "@/lib/entity";

export default async function NewInvoicePage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  const { company } = await requireCompany(cid, { write: true });
  const d = lineDefaults(company);
  const dir = sp.dir === "in" ? "in" : "out";
  const o = await formOptions(cid);
  const acc = (code: string) => o.accounts.find((a) => a.code === code)?.id ?? o.accounts[0]?.id ?? 0;
  const vat = (code: string) => o.vatCodes.find((v) => v.code === code)?.id ?? o.vatCodes[0]?.id ?? 0;
  const t = today();
  // Előkitöltés query paraméterekből (pl. EPR összesítő → MOHU-számla): partner (névrészlet), acc, vat, desc, amount, note.
  const pre = sp.partner ? o.partners.find((p) => p.name.toLowerCase().includes(sp.partner.toLowerCase())) : undefined;
  return (
    <>
      <h1>{dir === "out" ? "Új vevőszámla" : "Új szállítói számla / beszerzés"}</h1>
      {o.partners.length === 0 && (
        <div className="flash error">Előbb vegyél fel partnert: <Link href={`/c/${cid}/partners`}>Partnerek</Link></div>
      )}
      <InvoiceForm
        cid={cid}
        direction={dir}
        defaults={d}
        {...o}
        initial={{
          partnerId: pre?.id ?? null,
          invoiceNumber: "",
          issueDate: t,
          fulfillmentDate: t,
          dueDate: "",
          paymentMethod: "transfer",
          currency: "HUF",
          exchangeRate: "",
          rateManual: false,
          periodic: false,
          note: sp.note ?? "",
          lines: [{
            description: sp.desc ?? "",
            quantity: "1",
            unitPrice: sp.amount ?? "",
            vatCodeId: vat(sp.vat ?? (dir === "out" ? d.outVat : d.inVat)),
            accountId: acc(sp.acc ?? (dir === "out" ? d.outAcc : d.inAcc)),
            vehicleId: null,
          }],
        }}
      />
    </>
  );
}
