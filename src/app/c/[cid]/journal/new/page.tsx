import { requireCompany } from "@/lib/auth";
import { formOptions } from "@/lib/options";
import { EntryForm } from "@/components/EntryForm";
import { today } from "@/lib/dates";

export default async function NewEntryPage({ params }: { params: Promise<{ cid: string }> }) {
  const cid = Number((await params).cid);
  await requireCompany(cid, { write: true });
  const o = await formOptions(cid);
  return (
    <>
      <h1>Vegyes / bank / pénztár tétel</h1>
      <p className="muted">Pl. tőkebefizetés, tagi kölcsön, bankköltség, bérek, értékcsökkenés, nyitó tételek. Számlához kötött pénzmozgást a számla oldalán rendezz.</p>
      <EntryForm cid={cid} accounts={o.accounts} partners={o.partners} vehicles={o.vehicles} today={today()} />
    </>
  );
}
