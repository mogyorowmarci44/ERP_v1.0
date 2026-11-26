import { notFound, redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCompany } from "@/lib/auth";
import { formOptions } from "@/lib/options";
import { moduleOn } from "@/lib/modules";
import { InvoiceForm } from "@/components/InvoiceForm";
import { lineDefaults } from "@/lib/entity";

export default async function EditInvoicePage({ params }: { params: Promise<{ cid: string; id: string }> }) {
  const p = await params;
  const cid = Number(p.cid);
  const id = Number(p.id);
  const { company } = await requireCompany(cid, { write: true });
  const [inv] = await db.select().from(schema.invoices).where(and(eq(schema.invoices.id, id), eq(schema.invoices.companyId, cid)));
  if (!inv) notFound();
  if (inv.status !== "draft") redirect(`/c/${cid}/invoices/${id}?error=${encodeURIComponent("Csak piszkozat szerkeszthető.")}`);
  const lines = await db.select().from(schema.invoiceLines).where(eq(schema.invoiceLines.invoiceId, id)).orderBy(asc(schema.invoiceLines.position));
  const o = await formOptions(cid, lines.filter((l) => l.vehicleId).map((l) => l.vehicleId!));
  const [orig] = inv.correctsInvoiceId ? await db.select({ id: schema.invoices.id, number: schema.invoices.invoiceNumber }).from(schema.invoices).where(eq(schema.invoices.id, inv.correctsInvoiceId)) : [];
  return (
    <>
      <h1>Számla szerkesztése – {inv.invoiceNumber}</h1>
      {inv.reuseEntryNumber && (
        <p className="flash error">Ez a számla javításra újra van nyitva (eredeti tétel: {inv.reuseEntryNumber}), jelenleg nincs a könyvelésben. Javítás után nyomd meg a „Mentés és könyvelés” gombot – ugyanazt a tételszámot kapja vissza.</p>
      )}
      <InvoiceForm
        cid={cid}
        direction={inv.direction}
        invoiceId={id}
        defaults={lineDefaults(company)}
        {...o}
        items={moduleOn(company, "inventory") || lines.some((l) => l.itemId) ? o.items : []}
        corrects={orig ?? null}
        initial={{
          partnerId: inv.partnerId,
          invoiceNumber: inv.invoiceNumber,
          issueDate: inv.issueDate,
          fulfillmentDate: inv.fulfillmentDate,
          dueDate: inv.dueDate ?? "",
          paymentMethod: inv.paymentMethod,
          currency: inv.currency,
          exchangeRate: inv.currency === "HUF" ? "" : String(inv.exchangeRate).replace(".", ","),
          rateManual: inv.rateSource === "manual",
          periodic: inv.periodic,
          note: inv.note ?? "",
          lines: lines.map((l) => ({
            description: l.description,
            quantity: String(l.quantity).replace(".", ","),
            unitPrice: String(l.unitPrice).replace(".", ","),
            vatCodeId: l.vatCodeId,
            accountId: l.accountId,
            vehicleId: l.vehicleId,
            itemId: l.itemId,
          })),
        }}
      />
    </>
  );
}
