import { describe, expect, it } from "vitest";
import { fillTerkep, scriptJson } from "@/lib/terkep";

describe("ERP-térkép sablon", () => {
  it("a cégnév nem tudja lezárni a script blokkot", () => {
    const out = scriptJson([{ id: 1, name: "</script><script>alert(1)</script>", entityType: "company" }]);
    expect(out).not.toContain("</script>");
    expect(JSON.parse(out)[0].name).toBe("</script><script>alert(1)</script>");
  });
  it("kitölti a cégeket és a verziót, a $ jelet nem értelmezi", () => {
    const html = fillTerkep("const C = __COMPANIES__; v__VERSION__", [{ id: 2, name: "A $& B", entityType: "company" }], "4.1.0");
    expect(html).toContain('"A $& B"');
    expect(html).toContain("v4.1.0");
  });
});
