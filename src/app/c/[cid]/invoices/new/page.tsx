import Link from "next/link";
import { requireCompany } from "@/lib/auth";
import { formOptions } from "@/lib/options";
import { InvoiceForm } from "@/components/InvoiceForm";
import { today } from "@/lib/dates";

export default async function NewInvoicePage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  await requireCompany(cid, { write: true });
  const dir = sp.dir === "in" ? "in" : "out";
  const o = await formOptions(cid);
  const acc = (code: string) => o.accounts.find((a) => a.code === code)?.id ?? o.accounts[0]?.id ?? 0;
  const vat = (code: string) => o.vatCodes.find((v) => v.code === code)?.id ?? o.vatCodes[0]?.id ?? 0;
  const t = today();
  return (
    <>
      <h1>{dir === "out" ? "Új vevőszámla" : "Új szállítói számla / beszerzés"}</h1>
      {o.partners.length === 0 && (
        <div className="flash error">Előbb vegyél fel partnert: <Link href={`/c/${cid}/partners`}>Partnerek</Link></div>
      )}
      <InvoiceForm
        cid={cid}
        direction={dir}
        {...o}
        initial={{
          partnerId: null,
          invoiceNumber: "",
          issueDate: t,
          fulfillmentDate: t,
          dueDate: "",
          paymentMethod: "transfer",
          currency: "HUF",
          exchangeRate: "",
          note: "",
          lines: [{ description: "", quantity: "1", unitPrice: "", vatCodeId: vat("27"), accountId: acc(dir === "out" ? "913" : "523"), vehicleId: null }],
        }}
      />
    </>
  );
}
