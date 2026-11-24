import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ db: {}, schema: {} }));
import { deliver } from "@/lib/daily-summary/send";

describe("v3.9.8 – Gmail-továbbító (HTTPS)", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  it("a levelet és a CSV-mellékletet a továbbítónak adja át, a titkos kulccsal", async () => {
    vi.stubEnv("MAIL_RELAY_URL", "https://script.google.com/macros/s/x/exec");
    vi.stubEnv("MAIL_RELAY_SECRET", "titok-1234567890");
    const f = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    await deliver("a@b.hu", { subject: "Tárgy", html: "<b>x</b>", text: "x" }, [{ filename: "naplo.csv", content: "﻿a;b" }]);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://script.google.com/macros/s/x/exec");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ secret: "titok-1234567890", to: "a@b.hu", subject: "Tárgy", html: "<b>x</b>" });
    expect(Buffer.from(body.attachments[0].base64, "base64").toString("utf8")).toBe("﻿a;b");
  });
  it("a továbbító hibáját érthetően továbbadja", async () => {
    vi.stubEnv("MAIL_RELAY_URL", "https://script.google.com/macros/s/x/exec");
    vi.stubEnv("MAIL_RELAY_SECRET", "titok-1234567890");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false, error: "Érvénytelen titkos kulcs" }), { status: 200 })));
    await expect(deliver("a@b.hu", { subject: "T", html: "", text: "" })).rejects.toThrow(/Érvénytelen titkos kulcs/);
  });
});
