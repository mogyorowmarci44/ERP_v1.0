"use client";

import { useState } from "react";
import { payInvoiceAction } from "@/app/c/[cid]/actions";

type MoneyAcc = { id: number; code: string; name: string; currency: string };

/**
 * Kiegyenlítés – a pénzeszköz devizaneme szerint más adat kell (Szt. 60. §):
 *  - devizás számla forintszámláról: a ténylegesen terhelt / jóváírt forint,
 *  - devizaszámlára befolyó: MNB árfolyam (automatikus, felülírható),
 *  - devizaszámláról kifizetett: könyv szerinti átlagárfolyam (automatikus).
 */
export function PaymentForm(props: { cid: number; invoiceId: number; currency: string; direction: "out" | "in"; openFx: number; moneyAccounts: MoneyAcc[]; today: string }) {
  const { cid, invoiceId, currency, direction, openFx, today } = props;
  const usable = props.moneyAccounts.filter((a) => a.currency === "HUF" || a.currency === currency);
  const [accId, setAccId] = useState<number>(usable.find((a) => a.code.startsWith("384") && a.currency === "HUF")?.id ?? usable[0]?.id ?? 0);
  const acc = usable.find((a) => a.id === accId);
  const fxInvoice = currency !== "HUF";
  const hufAccount = acc?.currency === "HUF";

  return (
    <form action={payInvoiceAction} className="card form-grid no-print">
      <input type="hidden" name="cid" value={cid} />
      <input type="hidden" name="id" value={invoiceId} />
      <label>Dátum<input type="date" name="date" defaultValue={today} required /></label>
      <label>Pénzeszköz
        <select name="moneyAccountId" value={accId} onChange={(e) => setAccId(Number(e.target.value))}>
          {usable.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}{a.currency !== "HUF" ? ` (${a.currency})` : ""}</option>)}
        </select>
      </label>
      <label>Kiegyenlített összeg ({currency})<input name="amountFx" className="num" defaultValue={String(openFx).replace(".", ",")} required /></label>
      {fxInvoice && hufAccount && (
        <label>{direction === "in" ? "Forintszámlán terhelt összeg (Ft)" : "Forintszámlán jóváírt összeg (Ft)"}
          <input name="moneyHuf" className="num" required placeholder="a bankszámlakivonat szerint" />
        </label>
      )}
      {fxInvoice && !hufAccount && direction === "out" && (
        <label>Árfolyam (üresen: aznapi MNB)<input name="fxRate" className="num" placeholder="MNB" /></label>
      )}
      {fxInvoice && !hufAccount && direction === "in" && (
        <p className="muted" style={{ alignSelf: "end", margin: 0 }}>A deviza a könyv szerinti átlagárfolyamon kerül kivezetésre.</p>
      )}
      <label>Megjegyzés<input name="note" /></label>
      <div style={{ alignSelf: "end" }}><button className="primary">Rendezés könyvelése</button></div>
    </form>
  );
}
