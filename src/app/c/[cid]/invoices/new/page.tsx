import { requireCompany } from "@/lib/auth";
import { formOptions } from "@/lib/options";
import { moduleOn } from "@/lib/modules";
import { InvoiceForm } from "@/components/InvoiceForm";
import { today } from "@/lib/dates";
import { lineDefaults } from "@/lib/entity";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";

export default async function NewInvoicePage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  const { company } = await requireCompany(cid, { write: true });
  const d = lineDefaults(company);
  // v2.2 – helyesbítő számla: az eredeti tételei negatív előjellel, a partner / irány / pénznem rögzítve
  const corrId = Number(sp.corrects) || 0;
  const [orig] = corrId ? await db.select().from(schema.invoices).where(and(eq(schema.invoices.id, corrId), eq(schema.invoices.companyId, cid))) : [];
  const origLines = orig ? await db.select().from(schema.invoiceLines).where(eq(schema.invoiceLines.invoiceId, orig.id)).orderBy(asc(schema.invoiceLines.position)) : [];
  const dir = orig ? orig.direction : sp.dir === "in" ? "in" : "out";
  const o = await formOptions(cid, origLines.filter((l) => l.vehicleId).map((l) => l.vehicleId!));
  const acc = (code: string) => o.accounts.find((a) => a.code === code)?.id ?? o.accounts[0]?.id ?? 0;
  const vat = (code: string) => o.vatCodes.find((v) => v.code === code)?.id ?? o.vatCodes[0]?.id ?? 0;
  const t = today();
  return (
    <>
      <h1>{orig ? `Helyesbítő ${dir === "out" ? "vevőszámla" : "szállítói számla"} – ${orig.invoiceNumber}` : dir === "out" ? "Új vevőszámla" : "Új szállítói számla / beszerzés"}</h1>
      <InvoiceForm
        cid={cid}
        direction={dir}
        defaults={d}
        {...o}
        items={moduleOn(company, "inventory") ? o.items : []}
        corrects={orig ? { id: orig.id, number: orig.invoiceNumber } : null}
        initial={orig ? {
          partnerId: orig.partnerId,
          invoiceNumber: "",
          issueDate: t,
          fulfillmentDate: t,
          dueDate: "",
          paymentMethod: orig.paymentMethod,
          currency: orig.currency,
          exchangeRate: orig.currency === "HUF" ? "" : String(orig.exchangeRate),
          rateManual: orig.currency !== "HUF",
          periodic: orig.periodic,
          note: `Helyesbítés: ${orig.invoiceNumber}`,
          lines: origLines.map((l) => ({ description: `Helyesbítés: ${l.description}`, quantity: "1", unitPrice: String(-Number(l.unitPrice) * Number(l.quantity)), vatCodeId: l.vatCodeId, accountId: l.accountId, vehicleId: l.vehicleId, itemId: null, costCenterId: l.costCenterId })),
        } : {
          partnerId: null,
          invoiceNumber: "",
          issueDate: t,
          fulfillmentDate: t,
          dueDate: "",
          paymentMethod: "transfer",
          currency: "HUF",
          exchangeRate: "",
          rateManual: false,
          periodic: false,
          note: "",
          lines: [{ description: "", quantity: "1", unitPrice: "", vatCodeId: vat(dir === "out" ? d.outVat : d.inVat), accountId: acc(dir === "out" ? d.outAcc : d.inAcc), vehicleId: null }],
        }}
      />
    </>
  );
}
