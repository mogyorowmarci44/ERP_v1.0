/**
 * v3.10.0 – Visszatérés a bank jóváhagyó felületéről (Enable Banking → Erste George).
 * Ezt a címet kell megadni az Enable Banking alkalmazás „Redirect URLs” mezőjében: https://<erp>/api/bank/callback
 */
import { NextResponse } from "next/server";
import { getUser, isMember } from "@/lib/auth";
import type { BankLink } from "@/db/schema";
import { createSession } from "@/lib/bank/enable-banking";
import { appBaseUrl, verifyState } from "@/lib/bank/state";
import { getInboxSettings, saveInboxSettings } from "@/lib/inbox/service";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const base = appBaseUrl(req);
  const back = (cid: number | null, q: Record<string, string>) =>
    NextResponse.redirect(`${base}${cid ? `/c/${cid}/inbox/settings` : "/"}?${new URLSearchParams(q)}#bank`);

  let st;
  try { st = await verifyState(url.searchParams.get("state") ?? ""); }
  catch { return back(null, { error: "A banki visszahívás lejárt vagy érvénytelen – indítsd újra az összekapcsolást." }); }

  const user = await getUser();
  const m = user && user.id === st.uid ? await isMember(user.id, st.cid) : null;
  if (!m || m.role === "viewer") return back(st.cid, { error: "Jelentkezz be ugyanazzal a felhasználóval, és indítsd újra az összekapcsolást." });

  const err = url.searchParams.get("error");
  if (err) return back(st.cid, { error: `A bank nem adott hozzáférést: ${url.searchParams.get("error_description") || err}` });
  const code = url.searchParams.get("code");
  if (!code) return back(st.cid, { error: "Hiányzik a bank válaszából az engedélykód." });

  try {
    const s = await createSession(code);
    if (!s.accounts?.length) throw new Error("A hozzájárulás nem tartalmaz egyetlen számlát sem – a bank felületén jelöld ki a cég számláját.");
    const link: BankLink = {
      provider: "enablebanking",
      aspsp: s.aspsp ?? { name: st.aspsp, country: st.country },
      psuType: st.psuType,
      sessionId: s.session_id,
      validUntil: s.access?.valid_until ?? null,
      accounts: s.accounts.map((a) => ({ uid: a.uid, iban: a.account_id?.iban ?? null, name: a.name ?? a.product ?? null, currency: (a.currency || "HUF").toUpperCase(), enabled: true })),
      since: st.since,
      connectedAt: new Date().toISOString(),
    };
    const { settings } = await getInboxSettings(st.cid);
    await saveInboxSettings(st.cid, { ...settings, bank: link });
    return back(st.cid, { ok: `Bank összekapcsolva: ${link.accounts.length} számla, a hozzájárulás érvényes eddig: ${link.validUntil?.slice(0, 10) ?? "?"}.` });
  } catch (e) {
    return back(st.cid, { error: (e as Error).message });
  }
}
