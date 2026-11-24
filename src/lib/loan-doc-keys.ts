/** v4.5.1 – Tagi kölcsön okirat-kulcsok a nyomtatáshoz: c:<entryId> szerződés, m:<entryId>:<seq> módosítás, r:<entryId> visszafizetés. */
export type DocKey = { kind: "c" | "r"; entryId: number; seq?: undefined } | { kind: "m"; entryId: number; seq: number };

export function parseDocKeys(s: string): DocKey[] {
  const out: DocKey[] = [];
  const seen = new Set<string>();
  for (const raw of s.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 200)) {
    const m = /^(c|r):(\d+)$/.exec(raw) ?? /^(m):(\d+):(\d+)$/.exec(raw);
    if (!m || seen.has(raw)) continue;
    seen.add(raw);
    out.push(m[1] === "m" ? { kind: "m", entryId: Number(m[2]), seq: Number(m[3]) } : { kind: m[1] as "c" | "r", entryId: Number(m[2]) });
  }
  return out;
}

export const contractKey = (entryId: number) => `c:${entryId}`;
export const amendmentKey = (entryId: number, seq: number) => `m:${entryId}:${seq}`;
export const repaymentKey = (entryId: number) => `r:${entryId}`;
