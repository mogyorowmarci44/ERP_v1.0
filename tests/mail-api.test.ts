import { describe, expect, it } from "vitest";
import { buildRequest, parseFrom } from "../src/lib/mail-api";

const mail = { subject: "Tárgy", html: "<p>Szia</p>", text: "Szia" };

describe("tranzakciós e-mail API (v6.7.0)", () => {
  it("feladó értelmezése", () => {
    expect(parseFrom('"mogyorosi.erp" <noreply@mogyorosi.hu>')).toEqual({ name: "mogyorosi.erp", email: "noreply@mogyorosi.hu" });
    expect(parseFrom("noreply@mogyorosi.hu")).toEqual({ email: "noreply@mogyorosi.hu" });
  });

  it("Brevo kérés", () => {
    const r = buildRequest("brevo", "KEY", "mogyorosi.erp <noreply@x.hu>", "a@b.hu", mail, [{ filename: "a.csv", content: "x;y" }]);
    expect(r.url).toBe("https://api.brevo.com/v3/smtp/email");
    expect((r.init.headers as unknown as Record<string, string>)["api-key"]).toBe("KEY");
    const b = JSON.parse(r.init.body as string);
    expect(b.sender).toEqual({ email: "noreply@x.hu", name: "mogyorosi.erp" });
    expect(b.to).toEqual([{ email: "a@b.hu" }]);
    expect(b.attachment[0]).toEqual({ name: "a.csv", content: Buffer.from("x;y").toString("base64") });
  });

  it("Resend kérés; ismeretlen szolgáltató hiba", () => {
    const r = buildRequest("resend", "KEY", "noreply@x.hu", "a@b.hu", mail);
    expect(r.url).toBe("https://api.resend.com/emails");
    expect((r.init.headers as unknown as Record<string, string>).Authorization).toBe("Bearer KEY");
    expect(JSON.parse(r.init.body as string)).toMatchObject({ from: "noreply@x.hu", to: ["a@b.hu"], subject: "Tárgy" });
    expect(() => buildRequest("x", "k", "f", "t", mail)).toThrow(/Ismeretlen/);
  });
});
