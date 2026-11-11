"""PezCar tagi kölcsön frissítő csomag (mm-erp-import/1, csak memberLoanTerms + memberLoanRepayments).

Forrás: a 2025-ös és a 2026-os Excel-ERP „Tagi_Kölcsön_Nyilvántartás” munkalapja (CSV dump) és a 2026-os főkönyvi napló.
 - TK = befizetés: szerződésszám, eredeti lejárat, hosszabbítások („Hosszabbítva N nappal”),
 - TKV = visszafizetés: bizonylatszám és a törlesztett TK (2025-ben a nyilvántartás szerint; ahol nincs megadva: FIFO).
A 2026-os befizetések a régi ERP-ben bizonylatszám nélkül szerepelnek – időrendben TK-2026-001…-et kapnak.
A hosszabbítás kelte a forrásban nincs rögzítve: a módosítás az előző lejárat napján kelt (a lejárat napján írták alá).

Használat: python3 loan_docs.py /tmp/outputs/pezcar-tagi-kolcson.json
"""
import csv, json, re, sys
from datetime import date, timedelta

SRC = "/home/claude/pezcar-csv"
MEMBER = "Mogyorósi Márton Kálmán"

def rows(path):
    return [r + [""] * 14 for r in list(csv.reader(open(path, encoding="utf-8")))[1:] if r and r[0]]

def plus(d, n):
    return (date.fromisoformat(d) + timedelta(days=n)).isoformat()

ext_re = re.compile(r"hosszabb[ií]tva\s+(\d+)\s+nappal", re.I)

def build():
  terms, reps, log = [], [], []

  # --- 2025-ös ERP: TK / TKV bizonylatszámokkal ---------------------------------------------------
  for r in rows(f"{SRC}/2025/Tagi_Kölcsön_Nyilvántartás.csv"):
      d, no, kind, amt, name, due, mode, note = r[0], r[1], r[2], float(r[3]), r[4].strip(), r[5], r[6], r[7]
      if "befizetés" in kind:
          exts = [{"extendedOn": due, "days": int(m.group(1)), "note": None} for m in ext_re.finditer(note)]
          cur = {"currency": None, "amountFx": None}
          eur = re.search(r"([\d.]+)\s*EUR", note)
          t = {"date": d, "amount": amt, "partner": name, "contractNo": no, "originalDueDate": due,
               "dueDate": plus(due, sum(e["days"] for e in exts)), "extensions": exts,
               "note": f"{eur.group(1)} EUR készpénzben átadva, forintban nyilvántartva (régi ERP)" if eur else None}
          terms.append(t)
      else:
          reps.append({"date": d, "amount": amt, "partner": name, "docNo": no,
                       "allocations": [{"contractNo": note, "amount": amt}] if note.startswith("TK-") else None, "note": None})

  # --- 2026-os ERP: új befizetések és visszafizetések (bizonylatszám nélkül) ----------------------
  seq_tk, seq_tkv = 0, 0
  for r in rows(f"{SRC}/2026/Tagi_Kölcsön_Nyilvántartás.csv"):
      if not r[0].startswith("2026"):
          continue
      d, kind, amt, name = r[0], r[2], float(r[3]), r[4].strip()
      if "befizetés" in kind:
          seq_tk += 1
          orig, ext_days, new_due, note2 = r[5], r[6], r[7], r[9]
          m = ext_re.search(note2)
          days = int(m.group(1)) if m else 0
          if days and new_due and plus(orig, days) != new_due:
              log.append(f"TK-2026-{seq_tk:03d}: eredeti {orig} + {days} nap ≠ új lejárat {new_due} – az új lejárat a mérvadó")
              days = (date.fromisoformat(new_due) - date.fromisoformat(orig)).days
          exts = [{"extendedOn": orig, "days": days, "note": None}] if days else []
          terms.append({"date": d, "amount": amt, "partner": name, "contractNo": f"TK-2026-{seq_tk:03d}", "originalDueDate": orig,
                        "dueDate": new_due or orig, "extensions": exts, "note": None})
      else:
          seq_tkv += 1
          reps.append({"date": d, "amount": amt, "partner": name, "docNo": f"TKV-2026-{seq_tkv:03d}", "allocations": None,
                       "note": "A régi ERP nem rögzítette, melyik kölcsönt törleszti – FIFO."})
  return terms, reps, log


if __name__ == "__main__":
  terms, reps, log = build()
  bundle = {
      "format": "mm-erp-import/1",
      "source": "PezCar Excel-ERP 2025 + 2026 – Tagi kölcsön nyilvántartás",
      "partners": [], "vehicles": [], "documents": [],
      "memberLoanTerms": terms,
      "memberLoanRepayments": reps,
      "log": [[l] for l in log],
  }
  json.dump(bundle, open(sys.argv[1] if len(sys.argv) > 1 else "/tmp/outputs/pezcar-tagi-kolcson.json", "w"), ensure_ascii=False, indent=1)
  for t in terms:
      print(f"{t['contractNo']:12} {t['date']} {t['amount']:>10,.0f}  eredeti {t['originalDueDate']}  " + (" + ".join(f"{e['days']} nap" for e in t["extensions"]) or "–") + f"  → {t['dueDate']}" + (f"  [{t['note']}]" if t["note"] else ""))
  for r in reps:
      print(f"{r['docNo']:12} {r['date']} {r['amount']:>10,.0f}  → {', '.join(a['contractNo'] for a in r['allocations']) if r['allocations'] else 'FIFO'}")
  for l in log: print("!", l)
  