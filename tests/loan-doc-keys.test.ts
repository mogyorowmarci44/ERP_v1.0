import { describe, expect, it } from "vitest";
import { parseDocKeys } from "@/lib/loan-doc-keys";

describe("v4.5.1 – tagi kölcsön nyomtatási kulcsok", () => {
  it("szerződés, módosítás, visszafizetés; a hibásat és az ismétlést kihagyja", () => {
    expect(parseDocKeys("c:12,m:12:1,r:40,x:1,c:12,m:12")).toEqual([
      { kind: "c", entryId: 12 }, { kind: "m", entryId: 12, seq: 1 }, { kind: "r", entryId: 40 },
    ]);
    expect(parseDocKeys("")).toEqual([]);
  });
});
