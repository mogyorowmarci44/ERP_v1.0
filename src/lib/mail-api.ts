/**
 * v6.7.0 – Levélküldés tranzakciós e-mail szolgáltató HTTPS-API-ján, a saját domainről (pl. noreply@mogyorosi.hu).
 * A Render ingyenes csomagja a kimenő SMTP-t tiltja, ezért HTTPS-API kell. Támogatott: Brevo (300 levél/nap ingyen) és Resend.
 *
 * Környezeti változók: MAIL_PROVIDER=brevo|resend, MAIL_API_KEY, MAIL_FROM (pl. "mogyorosi.erp <noreply@mogyorosi.hu>").
 * A domaint a szolgáltatónál hitelesíteni kell (SPF / DKIM DNS-rekordok), különben a levelek spambe kerülnek.
 */
export type ApiMail = { subject: string; html: string; text: string };
export type ApiAttachment = { filename: string; content: string; mime?: string };

export const mailApiConfigured = () => !!(process.env.MAIL_PROVIDER && process.env.MAIL_API_KEY && process.env.MAIL_FROM);

/** "Név <cím>" → { name, email } */
export function parseFrom(from: string): { name?: string; email: string } {
  const m = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  return m ? { name: m[1].trim() || undefined, email: m[2].trim() } : { email: from.trim() };
}

/** A szolgáltató API-kérése (tesztelhető: a fetch kívülről adható). */
export function buildRequest(provider: string, key: string, from: string, to: string, mail: ApiMail, attachments: ApiAttachment[] = []) {
  const f = parseFrom(from);
  const b64 = (a: ApiAttachment) => Buffer.from(a.content, "utf8").toString("base64");
  if (provider === "brevo") {
    return {
      url: "https://api.brevo.com/v3/smtp/email",
      init: {
        method: "POST",
        headers: { "api-key": key, "Content-Type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          sender: { email: f.email, ...(f.name ? { name: f.name } : {}) }, to: [{ email: to }], subject: mail.subject, htmlContent: mail.html, textContent: mail.text,
          ...(attachments.length ? { attachment: attachments.map((a) => ({ name: a.filename, content: b64(a) })) } : {}),
        }),
      },
    };
  }
  if (provider === "resend") {
    return {
      url: "https://api.resend.com/emails",
      init: {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from, to: [to], subject: mail.subject, html: mail.html, text: mail.text,
          ...(attachments.length ? { attachments: attachments.map((a) => ({ filename: a.filename, content: b64(a) })) } : {}),
        }),
      },
    };
  }
  throw new Error(`Ismeretlen MAIL_PROVIDER: ${provider} (brevo vagy resend).`);
}

export async function deliverApi(to: string, mail: ApiMail, attachments: ApiAttachment[] = [], fetchImpl: typeof fetch = fetch) {
  const { url, init } = buildRequest(process.env.MAIL_PROVIDER!.toLowerCase(), process.env.MAIL_API_KEY!, process.env.MAIL_FROM!, to, mail, attachments);
  const res = await fetchImpl(url, { ...(init as unknown as RequestInit), signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`A levélküldő szolgáltató hibát adott: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
}
