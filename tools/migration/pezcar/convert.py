"""PezCar Excel (Főkönyvi Napló) -> MM ERP import csomag.

Szabályok (a forrás saját főkönyvi kivonata nettó/nettó elven számol, ami a pénzt rosszul mutatja):
  - Beszerzési csomag (T- nettó sor, ÁFA sor(ok), -K fizetési sor): szállítói számla + kiegyenlítés BRUTTÓ összeggel.
    Levonható ÁFA -> 466; nem levonható ÁFA -> a költség / készlet része (Szt. 47. §).
  - Különbözeti eladás (311/911 + 911/467): vevőszámla KÜL27 kóddal, gépkocsihoz kötve; ELÁBÉ az app könyv szerinti értékéből.
  - Minden más: vegyes / bank / pénztár tétel a megfeleltetett számlákkal.
"""
import sys, json, re, collections
sys.path.insert(0, "/home/claude/pezcar-tools")
from load import journal

ACC = {  # PezCar számla -> MM ERP számla
    "121": "141", "281": "261", "2811": "351", "311": "311", "381": "381", "382": "382", "3841": "384", "3842": "3842",
    "411": "411", "413": "414", "419": "419", "454": "454", "466": "466", "467": "467", "471": "471", "476": "463",
    "479": "4791", "532": "532", "594": "572", "861": "511", "862": "529", "863": "529", "864": "814", "865": "815",
    "871": "541", "872": "561", "891": "867", "911": "911", "912": "931", "961": "969", "969": "969", "582": "876",
}
EXTRA_ACCOUNTS = [  # az alap számlatükörben nem szereplő, a migrációhoz szükséges számlák
    {"code": "382", "name": "Valutapénztár (migrált, forintértéken)", "type": "asset", "currency": "HUF", "reportLine": "B.IV.1"},
    {"code": "3842", "name": "Devizaszámla EUR (migrált, forintértéken)", "type": "asset", "currency": "HUF", "reportLine": "B.IV.2"},
]
BANK_PARTNERS = {"Erste Bank"}
TAX_PARTNERS = {"Nemzeti adó és vámhivatal"}

def acc(code, memo=""):
    if code == "863" and re.search(r"hatósági|okmány|eredetiség|forgalomba|műszaki vizsg|illeték", memo, re.I): return "531"
    if code == "862" and re.search(r"hatósági", memo, re.I): return "531"
    if code == "861" and re.search(r"tankol|üzemanyag|benzin|gázolaj", memo, re.I): return "512"
    if code == "961" and re.search(r"kamat", memo, re.I): return "972"
    if code == "863" and re.search(r"biztosít", memo, re.I): return "533"
    if code not in ACC: raise KeyError(f"Nincs megfeleltetés: {code}")
    return ACC[code]

def r2(x): return round(float(x) + 0.0, 2)

def groups(j):
    """Egymást követő, azonos (dátum, bizonylatszám) sorok egy csoportba."""
    cur, key = [], None
    for r in j.itertuples():
        k = (r.date, r.doc)
        if key is not None and (k != key or r.doc == ""):
            yield cur; cur = []
        cur.append(r); key = k
    if cur: yield cur

if __name__ == "__main__" and len(sys.argv) == 1:
    for y in (2025, 2026):
        j = journal(y)
        kinds = collections.Counter()
        for g in groups(j):
            pats = [r.pat for r in g]
            if "T-" in pats: kinds["purchase_bundle"] += 1
            elif any(r.td == "311" and r.kd == "911" for r in g): kinds["sale"] += 1
            else: kinds["simple"] += 1
        print(y, dict(kinds))

# ---------------------------------------------------------------------------
# Gépkocsik a nyilvántartásokból
# ---------------------------------------------------------------------------
import csv

def num(s):
    try: return float(str(s).replace(",", "."))
    except Exception: return None

def norm(s): return re.sub(r"[\s\-]", "", str(s or "")).upper().replace("ELÁBÉ", "")

def load_vehicles():
    vs = {}  # id -> vehicle
    def add(v):
        # azonos jármű a két nyilvántartásban: VIN vagy rendszám/megnevezés egyezés
        for k, o in vs.items():
            if (v["vin"] and v["vin"] == o["vin"]) or (norm(v["label"]) == norm(o["label"]) and o["purchaseDate"] == v["purchaseDate"]):
                for f in ("vin", "saleInvoice", "saleDate", "salePrice", "saleVat"):
                    if v.get(f) and not o.get(f): o[f] = v[f]
                o["aliases"] |= {a for a in v["aliases"] if not a.startswith("AV")}; o["sources"] += v["sources"]
                if v.get("eur") and not o.get("eur"): o["eur"] = v["eur"]
                return o
        vs[v["key"]] = v
        return v
    rows = list(csv.reader(open("/home/claude/pezcar-csv/2025/Készlet_Nyilvántartás.csv")))[1:]
    for r in rows:
        r += [""] * 25
        doc, plate, vin, make, model = r[1], r[2], r[3], r[4], r[5]
        if not make: continue  # pl. „TOMKET SZLA AUTOGUMI” – nem gépkocsi
        add(dict(key=doc, doc=doc, label=plate, plate=plate if re.fullmatch(r"[A-Z]{3,4}\d{3}", plate.replace("-", "")) else "", vin=vin, make=make, model=model,
                 purchaseDate=r[6], purchasePrice=num(r[9]), saleInvoice=r[12] if r[12].isdigit() else "", saleDate=r[13], salePrice=num(r[14]),
                 saleVat=num(r[15]), aliases={norm(plate), norm(vin), norm(doc)} - {""}, sources=["2025"]))
    rows = list(csv.reader(open("/home/claude/pezcar-csv/2026/Gépjármű_Nyilvántartás.csv")))[1:]
    for r in rows:
        r += [""] * 25
        doc, plate, vin, make, model = r[0], r[1], r[2], r[3], r[4]
        if not make: continue
        add(dict(key=doc + "/26" if doc in vs else doc, doc=doc, label=plate, plate=plate if re.fullmatch(r"[A-Z]{3,4}\d{3}", plate.replace("-", "")) else "", vin=vin,
                 make=make, model=model.replace("Swfit", "Swift"), purchaseDate=r[5], purchasePrice=num(r[9]), saleInvoice=r[11] if r[11].isdigit() else "",
                 saleDate=r[12], salePrice=num(r[13]) if r[11].isdigit() else None, saleVat=num(r[14]) if r[11].isdigit() else None,
                 eur=num(r[7]) if num(r[7]) and num(r[7]) < 100000 else None, aliases={norm(plate), norm(vin), norm(doc)} - {""}, sources=["2026"]))
    return vs

def vehicle_finder(vs):
    by_alias, by_sale = {}, {}
    for v in vs.values():
        for a in v["aliases"]: by_alias.setdefault(a, v["key"])
        if v.get("saleInvoice"): by_sale[v["saleInvoice"]] = v["key"]
    def find(*texts):
        for t in texts:
            n = norm(t)
            if not n or n in ("-",): continue
            if n in by_alias: return by_alias[n]
            for a, k in by_alias.items():  # „LFX591 Akkumulátor” → LFX591
                if len(a) >= 6 and a in n: return k
        return None
    return find, by_sale

# ---------------------------------------------------------------------------
# Átalakítás
# ---------------------------------------------------------------------------
MONEY = {"381", "3841", "382", "3842"}
COSTLIKE = lambda c: bool(c) and (c[0] in "58" or c in ("281", "121", "2811"))

def vat_split(vrows, net):
    ded = sum(r.vat if r.vat else r.net for r in vrows if re.match(r"(levonható|50% levonható)", r.vattype.strip(), re.I))
    non = sum(r.vat if r.vat else r.net for r in vrows) - ded
    return r2(ded), r2(non)

def vat_code_for(net, vat, deductible):
    if abs(vat) < 0.005: return "TAH"
    rate = round(abs(vat / net) * 100) if net else 27
    rate = min((27, 18, 5), key=lambda x: abs(x - rate))
    return str(rate) if deductible else f"{rate}NL"

CUTOFF = "2026-11-09"  # a mai napnál későbbi (előre rögzített) tételek kimaradnak

def is_vat_row(x): return x.pat == "TK" and (x.td == "466" or x.td == x.kd)

def find_bundles(rows, log, year):
    """T- sor + közvetlenül utána következő ÁFA sorok + a hozzá tartozó -K fizetési sor (lehet később is)."""
    used, bundles = set(), []
    for idx, r in enumerate(rows):
        if r.pat != "T-" or idx in used: continue
        vat, k = [], idx + 1
        while k < len(rows) and is_vat_row(rows[k]) and k not in used:
            vat.append(k); k += 1
        pay = None
        # 1) azonos bizonylatszámú -K sor (akár későbbi dátummal)
        if r.doc and r.doc not in ("0",):
            pay = next((m for m in range(k, min(len(rows), k + 40)) if m not in used and rows[m].pat == "-K" and rows[m].doc == r.doc), None)
        # 2) közeli -K sor azonos nettó összeggel (bizonylatszám nélküli / „0” sorok)
        if pay is None:
            pay = next((m for m in range(k, min(len(rows), k + 4)) if m not in used and rows[m].pat == "-K" and abs(rows[m].net - r.net) < 0.01), None)
        if pay is None:
            log.append(("HIBA", f"{year}:{r.row}", r.doc, f"Beszerzés fizetési sor nélkül ({r.memo}, {r.net:.0f} Ft) – kihagyva, kézi rendezés kell"))
            used.add(idx); used.update(vat); continue
        used.add(idx); used.update(vat); used.add(pay)
        bundles.append((idx, vat, pay))
    return bundles, used

def convert():
    vs = load_vehicles()
    find, by_sale = vehicle_finder(vs)
    partners, docs, log = {}, [], []
    tyre_cost = [0.0]
    deposits = []
    def partner(name):
        name = (name or "").strip()
        if not name or name in ("???", "BALANCING"): name = "Ismeretlen partner"
        if name not in partners:
            private = not re.search(r"\b(kft|bt|zrt|nyrt|e\.?v|ev\.|kkt|s\.r\.o|b\.v|gmbh|kormányhivatal|minisztérium|bank|obi|hivatal|állomás|biztosító|pláza)\b|kft\.|bt\.", name, re.I)
            partners[name] = {"key": name, "name": name, "isPrivatePerson": bool(private) and name not in BANK_PARTNERS | TAX_PARTNERS | {"PezCar Kft", "Ismeretlen partner", "Tárgyi eszköz leírás"}}
        return name

    for year in (2025, 2026):
        j = journal(year)
        rows = []
        for r in j.itertuples():
            if r.doc == "PezCar - Évnyitás": continue
            if r.doc.startswith("Forecast"):
                log.append(("KIHAGYVA", f"{year}:{r.row}", r.doc, "Tervezett (Forecast) eladás – nem valós gazdasági esemény")); continue
            if r.date > CUTOFF:
                log.append(("KIHAGYVA", f"{year}:{r.row}", r.doc, f"Jövőbeli dátum ({r.date}) – előre rögzített tétel, {r.memo}, {r.net:.0f} Ft")); continue
            if r.memo == "Nem levonható ÁFA - átvezetés":
                log.append(("KIHAGYVA", f"{year}:{r.row}", r.doc, f"Év végi átvezetés a 466-ról a készletre ({r.net:.0f} Ft) – az új könyvelésben a nem levonható ÁFA már eleve a költség / készlet része")); continue
            rows.append(r)
        bundles, used = find_bundles(rows, log, year)

        for idx, vidx, pidx in bundles:
            r, vrows, pay = rows[idx], [rows[v] for v in vidx], rows[pidx]
            src = f"{year}:{r.row}"
            net = r2(r.net)
            ded = r2(sum(v.net for v in vrows if v.vattype.strip().lower() == "levonható"))
            if any("50%" in v.vattype for v in vrows):
                log.append(("FIGYELEM", src, r.doc, "„50% Levonható” ÁFA-sor: a forrás összesítője (és így a bevallás) nem vonta le – nem levonhatóként könyvelve"))
            non = r2(sum(v.net for v in vrows) - ded)
            gross_calc = r2(net + ded + non)
            if abs(gross_calc - r2(pay.gross)) > 1:
                log.append(("ELTÉRÉS", src, r.doc, f"Bruttó a forrásban {pay.gross:.2f}, nettó + ÁFA {gross_calc:.2f} – a nettó + ÁFA-t használom"))
            veh = find(r.car, r.memo) if r.td == "281" else None
            cost_acc = acc(r.td, r.memo)
            if r.td == "281" and not veh and re.search(r"gumi", r.memo, re.I):
                cost_acc = "262"
                tyre_cost[0] = round(net + non)
                log.append(("ÁTSOROLVA", src, r.doc, f"{r.memo}: nem gépkocsi, hanem áru → 262 (eladáskor ELÁBÉ a 262-ről)"))
            elif r.td == "281" and not veh:
                cost_acc = "529"
                log.append(("ÁTSOROLVA", src, r.doc, f"Gépkocsihoz nem köthető készlet-ráfordítás ({r.memo}, {r.car}) → 529 költség"))
            pdate = pay.date
            if r.td in MONEY:  # visszáru: pénz jön vissza
                docs.append({"kind": "entry", "src": src, "journal": "BA" if r.td == "3841" else "PE", "date": r.date, "ref": r.doc,
                             "description": f"Visszáru: {r.memo} – {r.partner}", "lines": [
                                 {"account": acc(r.td), "debit": gross_calc, "credit": 0, "partner": partner(r.partner)},
                                 {"account": acc(pay.kd, r.memo), "debit": 0, "credit": net, "partner": partner(r.partner)},
                                 {"account": "466", "debit": 0, "credit": r2(ded + non)}]})
                log.append(("JAVÍTÁS", src, r.doc, "Visszáru: az eredeti beszerzés levonható ÁFÁ-ja a 466-on visszafordítva"))
                continue
            if net < 0:  # jóváíró számla
                docs.append({"kind": "entry", "src": src, "journal": "PE" if pay.kd == "381" else "BA", "date": r.date, "ref": r.doc,
                             "description": f"Jóváírás: {r.memo} – {r.partner}", "lines": [
                                 {"account": acc(pay.kd), "debit": -gross_calc, "credit": 0, "partner": partner(r.partner)},
                                 {"account": cost_acc, "debit": 0, "credit": -r2(net + non), "partner": partner(r.partner), "vehicle": veh},
                                 *([{"account": "466", "debit": 0, "credit": -ded}] if ded else [])]})
                continue
            if ded and non:
                nd = r2(net * ded / (ded + non))
                lines = [{"description": r.memo, "unitPrice": nd, "vatCode": vat_code_for(nd, ded, True), "account": cost_acc, "vehicle": veh},
                         {"description": r.memo + " (nem levonható rész)", "unitPrice": r2(net - nd), "vatCode": vat_code_for(net - nd, non, False), "account": cost_acc, "vehicle": veh}]
            else:
                lines = [{"description": r.memo, "unitPrice": net, "vatCode": vat_code_for(net, ded or non, bool(ded) or not non), "account": cost_acc, "vehicle": veh}]
            docs.append({"kind": "invoice", "src": src, "direction": "in", "partner": partner(r.partner), "number": r.doc if r.doc not in ("", "0") else f"PEZ-{year}-{r.row}",
                         "date": r.date, "paymentMethod": {"Készpénz": "cash", "Bankkártya": "card"}.get(pay.pay, "transfer"), "lines": lines,
                         "payments": [{"date": max(pdate, r.date), "account": acc(pay.kd), "amount": gross_calc}]})

        rest = [r for i, r in enumerate(rows) if i not in used]
        for g in groups_of(rest):
            date, doc, src = g[0].date, g[0].doc, f"{year}:{g[0].row}"
            for x in g:
                if x.pat != "TK":
                    log.append(("HIBA", f"{year}:{x.row}", x.doc, f"Pár nélküli sor ({x.pat} {x.td or x.kd} {x.net:.0f} Ft, {x.memo}) – kihagyva, kézi rendezés kell"))
            g = [x for x in g if x.pat == "TK"]
            sale = [x for x in g if x.td == "311" and x.kd == "911"]
            if sale:
                s = sale[0]
                vat_rows = [x for x in g if x.td == "911" and x.kd == "467"]
                vk = by_sale.get(doc) or find(s.car, s.memo)
                declared = r2(sum(x.net for x in vat_rows))
                if vk and vs[vk]["purchaseDate"] and date < vs[vk]["purchaseDate"]:
                    reg = vs[vk].get("saleDate") or ""
                    if reg >= vs[vk]["purchaseDate"] and reg[:7] == date[:7]:
                        log.append(("JAVÍTÁS", src, doc, f"Az eladás dátuma ({date}) korábbi a vételnél ({vs[vk]['purchaseDate']}) – a nyilvántartás szerinti {reg} dátummal (azonos ÁFA-időszak)"))
                        date = reg
                    else:
                        log.append(("HIBA", src, doc, f"Az eladás dátuma ({date}) korábbi a vételnél ({vs[vk]['purchaseDate']})"))
                if vk:
                    docs.append({"kind": "invoice", "src": src, "direction": "out", "partner": partner(s.partner), "number": doc, "date": date,
                                 "paymentMethod": "transfer", "declaredVat": declared, "vehicle": vk,
                                 "lines": [{"description": s.memo, "unitPrice": r2(s.net), "vatCode": "KÜL27", "account": "911", "vehicle": vk}], "payments": []})
                else:  # nem gépkocsi (pl. gumiszett) – a bevallott ÁFA-val vegyes tételként
                    log.append(("FIGYELEM", src, doc, f"Nem gépkocsihoz kötött különbözeti eladás ({s.memo}) – vegyes tételként, a bevallott {declared:.0f} Ft ÁFA-val. Adózásilag ellenőrizendő."))
                    gross = r2(s.net)
                    if re.search(r"gumi", s.memo, re.I) and abs(round(gross * 27 / 127) - round(declared)) <= 1:
                        docs.append({"kind": "invoice", "src": src, "direction": "out", "partner": partner(s.partner), "number": doc, "date": date,
                                     "paymentMethod": "transfer", "declaredVat": declared,
                                     "lines": [{"description": s.memo, "unitPrice": r2(gross - declared), "vatCode": "27", "account": "914", "vehicle": None}], "payments": []})
                        docs.append({"kind": "entry", "src": src, "journal": "VN", "date": date, "ref": f"{doc}-ELÁBÉ", "description": f"ELÁBÉ: {s.memo}",
                                     "lines": [{"account": "811", "debit": round(tyre_cost[0]), "credit": 0}, {"account": "262", "debit": 0, "credit": round(tyre_cost[0])}]})
                        log.append(("FIGYELEM", src, doc, f"{s.memo}: a forrás különbözeti ÁFA-ként vallotta ({declared:.0f} Ft). Az áru ÁFA-s számlával érkezett, ezért tartalmilag normál 27%-os értékesítés. Az ÁFA összege ugyanannyi, csak a bevallási sor más."))
                    else:
                        log.append(("HIBA", src, doc, f"Nem gépkocsihoz kötött különbözeti eladás ({s.memo}) – kihagyva, kézi rögzítés kell"))
                g = [x for x in g if x not in sale and x not in vat_rows]
            for x in g:
                if x.td == "864" and x.kd == "281":
                    key = x.doc.split("-AV")[0]
                    docs.append({"kind": "cogs_ref", "src": src, "ref": x.doc, "amount": r2(x.net), "vehicle": by_sale.get(key) or find(key, x.car, x.memo)})
                    continue
                if x.memo.startswith("Szolgáltatás ÁFA - átsorolás"):
                    if x.net > 0:
                        log.append(("FIGYELEM", f"{year}:{x.row}", x.doc, f"ÁFA-átsorolás nem levonhatóból levonhatóba ({x.net:.0f} Ft, {x.date[:7]}) – a forrás havi ÁFA-összesítőjében nem szerepel, ezért nem könyveltem. Ha a bevallásban levontátok, szólj."))
                    continue
                if x.td == x.kd or abs(x.net) < 0.005: continue
                if x.td in MONEY and x.kd == "311":
                    key = x.doc.split("-AV")[0]
                    docs.append({"kind": "sale_payment", "src": f"{year}:{x.row}", "date": x.date, "ref": x.doc, "vehicle": by_sale.get(key) or find(key, x.car),
                                 "saleInvoice": key if key.isdigit() else None, "account": acc(x.td), "amount": r2(x.net), "partner": partner(x.partner)})
                    continue
                if x.td == "281" and x.kd in MONEY and re.search(r"vásárolt autó|vétel", x.memo, re.I):
                    vk = find(x.doc, x.car, x.memo)
                    prev = next((d for d in reversed(docs) if d.get("kind") == "invoice" and d["direction"] == "in" and d["number"] == x.doc), None)
                    if prev:  # részteljesítés: ugyanaz a bizonylat több fizetéssel
                        prev["lines"][0]["unitPrice"] = r2(prev["lines"][0]["unitPrice"] + x.net)
                        prev["payments"].append({"date": x.date, "account": acc(x.kd), "amount": r2(x.net)})
                        continue
                    if not vk: log.append(("HIBA", f"{year}:{x.row}", x.doc, f"Gépkocsi-vásárlás, a jármű nem azonosítható ({x.car})"))
                    docs.append({"kind": "invoice", "src": f"{year}:{x.row}", "direction": "in", "partner": partner(x.partner or "Magánszemély"), "number": x.doc or f"PEZ-{year}-{x.row}",
                                 "date": x.date, "paymentMethod": "cash" if x.kd == "381" else "transfer", "vehicle": vk,
                                 "lines": [{"description": x.memo + (f" – {vs[vk]['make']} {vs[vk]['model']} {vs[vk]['label']}" if vk else ""), "unitPrice": r2(x.net),
                                            "vatCode": "KÜL27", "account": "261", "vehicle": vk}],
                                 "payments": [{"date": x.date, "account": acc(x.kd), "amount": r2(x.net)}]})
                    continue
                if x.td == "281" and x.kd == "311":  # gépkocsi vásárlás a vevő tartozásába beszámítva
                    vk = find(x.doc, x.car, x.memo)
                    docs.append({"kind": "invoice", "src": f"{year}:{x.row}", "direction": "in", "partner": partner(x.partner), "number": x.doc,
                                 "date": x.date, "paymentMethod": "transfer", "vehicle": vk,
                                 "lines": [{"description": x.memo + (f" – {vs[vk]['make']} {vs[vk]['model']} {vs[vk]['label']}" if vk else ""), "unitPrice": r2(x.net),
                                            "vatCode": "KÜL27", "account": "261", "vehicle": vk}],
                                 "payments": [{"date": x.date, "account": "389", "amount": r2(x.net)}]})
                    docs.append({"kind": "sale_payment", "src": f"{year}:{x.row}", "date": x.date, "ref": f"{x.doc}-BESZÁMÍTÁS", "vehicle": None,
                                 "saleInvoice": None, "account": "389", "amount": r2(x.net), "partner": partner(x.partner)})
                    log.append(("JAVÍTÁS", f"{year}:{x.row}", x.doc, f"Beszámítás: {x.net:.0f} Ft vételár a vevő ({x.partner}) tartozásába – átvezetési számlán (389) rendezve"))
                    continue
                purchase_like = COSTLIKE(x.td) and x.td != "2811" and x.kd in MONEY and partner(x.partner) not in BANK_PARTNERS | TAX_PARTNERS | {"PezCar Kft", "Tárgyi eszköz leírás", "Ismeretlen partner"}
                vk = find(x.car, x.memo, x.doc) if "281" in (x.td, x.kd) else None
                cost = acc(x.td, x.memo)
                if x.td == "281" and not vk:
                    cost = "529"
                    log.append(("ÁTSOROLVA", f"{year}:{x.row}", x.doc, f"Gépkocsihoz nem köthető készlet-tétel ({x.memo}, {x.car}) → 529 költség"))
                if purchase_like and x.net < 0:  # visszatérítés (negatív sor): pénz jön vissza, költség csökken
                    docs.append({"kind": "entry", "src": f"{year}:{x.row}", "journal": "BA" if x.kd in ("3841", "3842") else "PE", "date": x.date, "ref": x.doc,
                                 "description": f"Visszatérítés: {x.memo} – {x.partner}", "lines": [
                                     {"account": acc(x.kd), "debit": -r2(x.net), "credit": 0, "partner": partner(x.partner)},
                                     {"account": cost, "debit": 0, "credit": -r2(x.net), "partner": partner(x.partner)}]})
                    log.append(("JAVÍTÁS", f"{year}:{x.row}", x.doc, f"Negatív beszerzési sor ({x.net:.0f} Ft) visszatérítésként: T {acc(x.kd)} / K {cost}"))
                    continue
                if purchase_like:
                    docs.append({"kind": "invoice", "src": f"{year}:{x.row}", "direction": "in", "partner": partner(x.partner), "number": x.doc or f"PEZ-{year}-{x.row}",
                                 "date": x.date, "paymentMethod": {"Készpénz": "cash", "Bankkártya": "card"}.get(x.pay, "transfer"),
                                 "lines": [{"description": x.memo, "unitPrice": r2(x.net), "vatCode": "TAH", "account": cost, "vehicle": vk if cost == "261" else None}],
                                 "payments": [{"date": x.date, "account": acc(x.kd), "amount": r2(x.net)}]})
                    continue
                if "Foglaló átvezetése" in x.memo:
                    log.append(("JAVÍTÁS", f"{year}:{x.row}", x.doc, f"Foglaló költségként leírása ({x.net:.0f} Ft, 861/2811) kihagyva – a foglalót a gépkocsi beszerzési értékébe aktiválom"))
                    continue
                if x.td == "2811" and x.kd in MONEY:
                    vk = find(x.car, x.memo)
                    if vk and x.net > 0:
                        pdate = max(vs[vk]["purchaseDate"] or x.date, x.date)
                        deposits.append({"kind": "entry", "src": f"{year}:{x.row}", "journal": "VN", "date": pdate, "ref": x.doc or f"FOGL-{vs[vk]['label']}",
                                         "description": f"Foglaló aktiválása a gépkocsira – {vs[vk]['make']} {vs[vk]['model']} {vs[vk]['label']}",
                                         "lines": [{"account": "261", "debit": r2(x.net), "credit": 0, "vehicle": vk}, {"account": "351", "debit": 0, "credit": r2(x.net), "partner": partner(x.partner)}]})
                        log.append(("JAVÍTÁS", f"{year}:{x.row}", x.doc, f"Foglaló {x.net:.0f} Ft → {vs[vk]['label']} beszerzési értéke ({pdate})"))
                if x.memo == "BALANCING" or x.partner == "BALANCING":
                    log.append(("FIGYELEM", f"{year}:{x.row}", x.doc, f"„BALANCING” egyeztető tétel ({x.net:.0f} Ft, {x.td}/{x.kd}) – átvéve, de ellenőrizd a bankkivonattal"))
                jn = "BA" if {"3841", "3842"} & {x.td, x.kd} else "PE" if {"381", "382"} & {x.td, x.kd} else "VN"
                docs.append({"kind": "entry", "src": f"{year}:{x.row}", "journal": jn, "date": x.date, "ref": x.doc, "description": f"{x.memo} – {x.partner}".strip(" –"),
                             "lines": [{"account": cost if x.td == "281" else acc(x.td, x.memo), "debit": r2(x.net), "credit": 0, "partner": partner(x.partner), "vehicle": vk if x.td == "281" and cost == "261" else None},
                                       {"account": acc(x.kd, x.memo), "debit": 0, "credit": r2(x.net), "partner": partner(x.partner), "vehicle": vk if x.kd == "281" else None}]})
    docs.extend(deposits)
    # 2025. évi társasági adó: a forrás csak a 2026-os évnyitásban szerepelteti (476 / 129 000 Ft)
    op = journal(2026)
    tao = op[(op.doc == "PezCar - Évnyitás") & (op.kd == "476")].net.sum()
    if tao:
        docs.append({"kind": "entry", "src": "2026:évnyitás", "journal": "VN", "date": "2025-12-31", "ref": "TAO-2025",
                     "description": "2025. évi társasági adó (a forrás 2026-os nyitómérlege szerint)",
                     "lines": [{"account": "891", "debit": r2(tao), "credit": 0}, {"account": "463", "debit": 0, "credit": r2(tao)}]})
        log.append(("PÓTLÁS", "2026:évnyitás", "TAO-2025", f"2025. évi TAO {tao:.0f} Ft lekönyvelve 2025-12-31-re (a 2025-ös naplóban nem szerepelt) – ellenőrizd a bevallással"))
        docs.append({"kind": "entry", "src": "felhasználói adat", "journal": "BA", "date": "2026-06-01", "ref": "TAO-2025-BEFIZ",
                     "description": "2025. évi társasági adó befizetése – Nemzeti adó és vámhivatal",
                     "lines": [{"account": "463", "debit": r2(tao), "credit": 0, "partner": partner("Nemzeti adó és vámhivatal")},
                               {"account": "384", "debit": 0, "credit": r2(tao), "partner": partner("Nemzeti adó és vámhivatal")}]})
        log.append(("PÓTLÁS", "felhasználói adat", "TAO-2025-BEFIZ", f"2025. évi TAO befizetése {tao:.0f} Ft, 2026-06-01, Erste HUF (a forrásban nem szerepelt)"))
    return vs, partners, docs, log

def groups_of(rows):
    cur, key = [], None
    for r in rows:
        k = (r.date, r.doc)
        if key is not None and (k != key or r.doc == ""):
            yield cur; cur = []
        cur.append(r); key = k
    if cur: yield cur

if __name__ == "__main__" and len(sys.argv) > 1 and sys.argv[1] == "stats":
    vs, partners, docs, log = convert()
    c = collections.Counter(d["kind"] + ("/" + d["direction"] if d["kind"] == "invoice" else "") for d in docs)
    print("vehicles", len(vs), "partners", len(partners), dict(c))
    for l in log: print(" ", l)


def build_bundle():
    vs, partners, docs, log = convert()
    def vout(v):
        return {"key": v["key"], "make": v["make"], "model": v["model"], "plate": v["plate"] or None, "vin": v["vin"] or None,
                "vatTreatment": "margin", "purchaseDate": v["purchaseDate"] or None,
                "purchasePrice": round(v["purchasePrice"]) if v.get("purchasePrice") else None,
                "note": f"Migrált ({'/'.join(v['sources'])}): {v['label']}" + (f", {v['eur']:.0f} EUR" if v.get("eur") and v["eur"] < 100000 else "")}
    # Ugyanaz a szállítói bizonylat (partner + szám + dátum) több részből → egy számla több tétellel
    merged, seen = [], {}
    for d in docs:
        if d["kind"] == "invoice" and d["direction"] == "in" and not d["number"].startswith("PEZ-"):
            k = (d["partner"], d["number"], d["date"])
            if k in seen:
                seen[k]["lines"] += d["lines"]; seen[k]["payments"] += d["payments"]
                continue
            seen[k] = d
        merged.append(d)
    docs = merged
    order = {"entry": 1, "invoice": 1, "sale_entry": 1, "sale_payment": 2, "cogs_ref": 3}
    docs = sorted(docs, key=lambda d: (d.get("date") or "9999", order[d["kind"]]))
    return {
        "format": "mm-erp-import/1",
        "source": "PEZCAR_KFT_1.0_2025.xlsm + PEZCAR_KFT_1.0_2026.xlsm",
        "company": {"name": "PezCar Kft"},
        "accounts": EXTRA_ACCOUNTS,
        "vatCodes": [{"code": f"{r}NL", "name": f"{r}% – nem levonható", "rate": r, "kind": "non_deductible"} for r in (27, 18, 5)],
        "partners": sorted(partners.values(), key=lambda p: p["name"]),
        "vehicles": [vout(v) for v in vs.values()],
        "documents": docs,
        "log": [list(l) for l in log],
    }

if __name__ == "__main__" and len(sys.argv) > 2 and sys.argv[1] == "bundle":
    b = build_bundle()
    json.dump(b, open(sys.argv[2], "w"), ensure_ascii=False, indent=1, default=str)
    print("írva:", sys.argv[2], {k: len(v) for k, v in b.items() if isinstance(v, list)})
