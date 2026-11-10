"""MM Car Trade Kft – import csomag (mm-erp-import/1) a Gmail / Drive / számlázz.hu bizonylataiból.

Források: OTP kivonat 001-003/2026 (aug–okt), számlázz.hu kimenő számlák, AUTO1 / Használtautó.hu / KBOSS
e-számlák, papírszámla-fotók (Bitu-express, FM Drive, Standard Color, Euronics), adásvételi (Fiat Punto).
A FELTÉTELEZETT tételek a leírásban jelölve; a hiányzó bizonylatok listája a csomag `log`-jában.
"""
import json, sys

OUT = sys.argv[1] if len(sys.argv) > 1 else "/home/claude/mmct/mmct-import.json"

# --- Ismeretlen beszerzések (a felhasználó válasza alapján kitöltendő) -----------------
# None → a gépkocsi beszerzése kimarad a csomagból (és figyelmeztetés kerül a logba)
LANCER_SWJ_PURCHASE = {"date": "2026-08-30", "partner": "Ismeretlen eladó (Lancer SWJ-792)", "price": 1850000, "account": "381",
                       "number": "AV-2026-08-30-LANCER", "src": "felhasználó (2026.11.10.)"}
# FELTÉTELEZETT: a 10 000 EUR tagi kölcsönből (08.15.), ára 10 000 EUR – megerősítendő
MAZDA_PURCHASE = {"date": "2026-08-15", "partner": "Ismeretlen eladó (Mazda CX-5)", "priceFx": 10000.0, "currency": "EUR", "account": "3811",
                  "number": "AV-2026-08-15-MAZDA", "src": "felhasználó (2026.11.10.) – ár FELTÉTELEZETT"}

TAG = "Mogyorósi Bálint Gábor"
partners = {}
def P(key, name=None, tax=None, private=False, country="HU"):
    partners[key] = {"key": key, "name": name or key, "taxNumber": tax, "isPrivatePerson": private, "country": country}
    return key

vehicles = []
def V(key, make, model, plate=None, vin=None, date=None, price=None, note=None):
    vehicles.append({"key": key, "make": make, "model": model, "plate": plate, "vin": vin, "vatTreatment": "margin",
                     "purchaseDate": date, "purchasePrice": price, "note": note})
    return key

docs, log = [], []
def inv(src, direction, partner, number, date, lines, payments=(), pm="transfer", **kw):
    d = {"kind": "invoice", "src": src, "direction": direction, "partner": partner, "number": number, "date": date,
         "paymentMethod": pm, "lines": [dict(description=l[0], unitPrice=l[1], vatCode=l[2], account=l[3], vehicle=(l[4] if len(l) > 4 else None)) for l in lines],
         "payments": [dict(date=p[0], account=p[1], amount=p[2], **({"moneyHuf": p[3]} if len(p) > 3 else {})) for p in payments]}
    d.update(kw)
    docs.append(d)

def ent(src, journal, date, ref, desc, lines):
    docs.append({"kind": "entry", "src": src, "journal": journal, "date": date, "ref": ref, "description": desc,
                 "lines": [dict(account=a, debit=dr, credit=cr, partner=(p[0] if p else None), vehicle=None) for a, dr, cr, *p in lines]})

# --- Partnerek ---------------------------------------------------------------------
P(TAG, private=True)
TAG2 = "Mogyorósi Márton"
P(TAG2, private=True)
P("Szendi Sándor", tax="91897147-1-37")
P("Nagy Csaba", private=True)
P("Földesi András", private=True)
P("Berkes Mónika", private=True)
P("AUTO1 European Cars B.V.", country="NL")
P("AUTO1 Group Operations SE", tax="DE286118911", country="DE")
P("Használtautó.hu Kft.")
P("KBOSS.hu Kft.", tax="13421739-2-41")
P("TAZO Kft. (PrintPix)", tax="14802575-2-04")
P("Bitu-express Kft.", tax="14770469-2-07")
P("FM Drive Auto Kft.", tax="33134581-2-07")
P("Vöröskő Kft. (Euronics)", tax="10233342-2-19")
P("Standard Color Kft.", tax="23093500-2-19")
P("Dr. Horváth Anna", tax="53703226-1-27")
P("Egzakt 2003 Szolgáltató Kft.")
P("Generali Biztosító Zrt.")
P("OTP Bank Nyrt.")

# --- Gépkocsik -----------------------------------------------------------------------
V("COLT-055883", "Mitsubishi", "Colt", None, "XMCXNZ33A9F055883", "2026-08-27", 680000, "Szendi Sándor 1-2026-2")
V("LANCER-SWJ792", "Mitsubishi", "Lancer", "SWJ-792", "JMBSNCY2AAU000876",
  LANCER_SWJ_PURCHASE and LANCER_SWJ_PURCHASE["date"], LANCER_SWJ_PURCHASE and LANCER_SWJ_PURCHASE["price"], "Honosítva (Bitu-express 10.08.)")
V("MAZDA-CX5", "Mazda", "CX-5", None, "JMZKEK97600108406", MAZDA_PURCHASE["date"], None, "Eladva Berkes Mónikának (MM-2026-2)")
vehicles[-1]["purchasePriceFx"] = {"currency": "EUR", "amount": MAZDA_PURCHASE["priceFx"], "date": MAZDA_PURCHASE["date"]}
V("AUTO1-HW19696", "Mitsubishi", "Colt 1.3 Invite (2009)", "HGW-BS133", "XMCXNZ34A9F047385", "2026-10-26", None, "AUTO1 HW19696, 195 055 km")
V("AUTO1-BC60679", "Mitsubishi", "Lancer 1.6 Basis (2015)", "CO-M318", "JMBLNCX1AFU001777", "2026-11-05", None, "AUTO1 BC60679, 171 359 km")
V("AUTO1-SK62311", "Mitsubishi", "Lancer 1.6 ClearTec XTRA (2011)", "LD-Z5876", "JMBLNCX1ABU005314", "2026-11-05", None, "AUTO1 SK62311, 177 866 km")
V("PUNTO-KFH870", "Fiat", "Punto", "KFH-870", None, "2026-10-30", 550000, "Berkes Mónikától, adásvételi 2026.10.30.")

# ======================================================================================
# Bank 384 – OTP 11736006-21511835 (kivonat 001: 08.07–08.31, 002: szept., 003: okt.)
# ======================================================================================
ent("OTP 001", "BA", "2026-08-24", "OTP 001", "ATM egyenleglekérdezés díja", [("532", 80, 0), ("384", 0, 80)])
ent("OTP 001", "BA", "2026-08-25", "MW_31228926227", f"Jegyzett tőke befizetés – {TAG} (bankba utalva)", [("384", 400000, 0, TAG), ("411", 0, 400000, TAG)])
ent("Alapítás", "PE", "2026-08-01", "TŐKE-2026-08-01", "Jegyzett tőke rendelkezésre bocsátása készpénzben (99% / 1%)",
    [("381", 2600000, 0), ("411", 0, 2570000, TAG), ("411", 0, 30000, TAG2)])
docs.append({"kind": "entry", "src": "felhasználó (2026.11.10.)", "journal": "PE", "date": "2026-08-15", "ref": "TK-EUR-2026-08-15",
             "description": f"Tagi kölcsön 10 000 EUR készpénzben – {TAG}",
             "lines": [{"account": "3811", "amountFx": 10000.0, "fxCurrency": "EUR", "fxSide": "debit", "partner": TAG},
                       {"account": "4791", "amountFx": 10000.0, "fxCurrency": "EUR", "fxSide": "credit", "partner": TAG}]})
ent("OTP 001", "BA", "2026-08-25", "50064347485", "Generali KGFB első díjrészlet (Netrisk I38JM26)", [("533", 204567, 0, "Generali Biztosító Zrt."), ("384", 0, 204567)])
ent("OTP 001", "BA", "2026-08-31", "OTP 001", "Forgalmi különdíj (augusztus)", [("532", 921, 0, "OTP Bank Nyrt."), ("384", 0, 921)])
ent("OTP 002", "BA", "2026-09-07", "OTP 002", "Védelmező személybiztosítás díja", [("533", 7990, 0, "OTP Bank Nyrt."), ("384", 0, 7990)])
ent("OTP 002", "BA", "2026-09-30", "OTP 002", "Forgalmi különdíj (szeptember)", [("532", 382, 0, "OTP Bank Nyrt."), ("384", 0, 382)])
ent("OTP 003", "BA", "2026-10-05", "OTP 003", "Védelmező személybiztosítás díja", [("533", 7990, 0, "OTP Bank Nyrt."), ("384", 0, 7990)])
ent("OTP 003", "BA", "2026-10-26", "OTP 003", "Készpénz-befizetés díja (ATM)", [("532", 174, 0, "OTP Bank Nyrt."), ("384", 0, 174)])
ent("OTP 003", "BA", "2026-10-26", "U68X194242", "Devizaátutalás jutaléka (AUTO1 DEPR02396603)", [("532", 557, 0, "OTP Bank Nyrt."), ("384", 0, 557)])
ent("OTP 003", "BA", "2026-10-26", "U68X194244", "Devizaátutalás jutaléka (AUTO1 DETRPHL03358125)", [("532", 286, 0, "OTP Bank Nyrt."), ("384", 0, 286)])
ent("OTP 003", "BA", "2026-10-30", "OTP 003", "Pénztári készpénzbefizetés díja", [("532", 650, 0, "OTP Bank Nyrt."), ("384", 0, 650)])
ent("OTP 003", "BA", "2026-10-30", "OTP 003", "Forgalmi különdíj (október)", [("532", 5531, 0, "OTP Bank Nyrt."), ("384", 0, 5531)])
# Pénztár → bank átvezetés (389)
for d, amt, ref, txt in [("2026-10-15", 200000, "OTP 003", "Pénztári készpénzbefizetés (OTP fiók)"),
                         ("2026-10-26", 500000, "0000000100218981", "ATM készpénzbefizetés (2026.10.22., Székesfehérvár) – FELTÉTELEZETT: a pénztárból")]:
    ent("OTP 003", "PE", d if amt == 200000 else "2026-10-22", ref, txt + " – pénztárból kivét", [("389", amt, 0), ("381", 0, amt)])
    ent("OTP 003", "BA", d, ref, txt + " – jóváírás", [("384", amt, 0), ("389", 0, amt)])

# ======================================================================================
# Szállítói számlák
# ======================================================================================
# Ügyvéd – cégalapítás (bankszámla még nem volt → a tag fizette)
inv("Drive szamla.pdf", "in", "Dr. Horváth Anna", "DH-2026-93", "2026-08-01",
    [("Cégalapítás ügyvédi munkadíj (alanyi adómentes)", 50000, "AM", "529")], dueDate="2026-08-11")
ent("Drive szamla.pdf", "PE", "2026-08-11", "DH-2026-93", "Ügyvédi díj kifizetése készpénzben (a rendelkezésre bocsátott tőkéből)",
    [("454", 50000, 0, "Dr. Horváth Anna"), ("381", 0, 50000)])
# Bélyegző – webshop bankkártya 08.04. (a cégszámla csak 08.24-én indult → a tag kártyája)
inv("Drive eszamla_b26_3180", "in", "TAZO Kft. (PrintPix)", "B26/3180", "2026-08-04",
    [("C40-es bélyegző", 6488.20, "27", "513"), ("Házhozszállítás", 1567.00, "27", "513")], pm="card")
ent("Drive eszamla_b26_3180", "PE", "2026-08-04", "B26/3180", "Bélyegző kifizetése készpénzből (a rendelkezésre bocsátott tőkéből)",
    [("454", 10230, 0, "TAZO Kft. (PrintPix)"), ("381", 0, 10230)])
# Szendi Colt – KAH (különbözeti) beszerzés, készpénz
inv("Gmail 1-2026-2", "in", "Szendi Sándor", "1-2026-2", "2026-08-27",
    [("Mitsubishi Colt XMCXNZ33A9F055883 – különbözeti, használt cikk", 680000, "KÜL27", "261", "COLT-055883")],
    [("2026-08-27", "381", 680000)], pm="cash", vehicle="COLT-055883")
# Használtautó.hu – időszakos hirdetési csomag (teljesítés = fizetési határidő, Áfa tv. 58. §)
for num, per, kelt, due, net, vat, paid in [("P2026/22448", "08.27–08.31", "2026-09-01", "2026-09-16", 9800, 2646, "2026-09-15"),
                                           ("P2026/25718", "09.01–09.30", "2026-10-01", "2026-10-16", 58800, 15876, "2026-10-15"),
                                           ("P2026/30264", "10.01–10.31", "2026-11-03", "2026-11-18", 58800, 15876, None)]:
    inv(f"Gmail {num}", "in", "Használtautó.hu Kft.", num, kelt, [(f"Hirdetés 10 db-os csomag {per}", net, "27", "524")],
        [(paid, "384", net + vat)] if paid else [], fulfillmentDate=due, dueDate=due, periodic=True)
# Egzakt 2003 – 63 500 = 50 000 + 27% (számla nincs meg: FELTÉTELEZETT tartalom)
for num, d, paid in [("A2003-2026-289", "2026-09-04", "2026-09-04"), ("A2003-2026-318", "2026-10-10", "2026-10-12")]:
    inv("OTP kivonat", "in", "Egzakt 2003 Szolgáltató Kft.", num, d, [("Szolgáltatási díj (FELTÉTELEZETT: könyvelés, 27%) – számla bekérendő", 50000, "27", "529")],
        [(paid, "384", 63500)])
# KBOSS – számlázz.hu #start előfizetés 2026.10.11–2027.10.10
inv("Gmail E-KBOSS-2026-661866", "in", "KBOSS.hu Kft.", "E-KBOSS-2026-661866", "2026-10-11",
    [("Számlázz.hu rendszerhasználat #start, 2026.10.11–2027.10.10", 20280, "27", "529")], [("2026-10-12", "384", 25756)])
# Bitu-express – honosítás (hatósági díjak TAH + műszaki vizsga 27%)
ent("felhasználó (2026.11.10.)", "PE", "2026-10-08", "TK-2026-10-08", f"Tagi kölcsön készpénzben – {TAG} (a pénztár hiánya a honosítás kifizetésekor; FELTÉTELEZETT)",
    [("381", 54393, 0, TAG), ("4791", 0, 54393, TAG)])
inv("Drive IMG_5375/5734", "in", "Bitu-express Kft.", "SZA01841/2026", "2026-10-08",
    [("Honosítás hatósági díjai (Áfa tv. hatályán kívül)", 37800, "TAH", "261", "LANCER-SWJ792"),
     ("Honosítási eljárás előzetes átvizsgálás (M1)", 20758, "27", "261", "LANCER-SWJ792")], [("2026-10-08", "381", 64163)], pm="cash",
    note="Gépkocsi hozzárendelés FELTÉTELEZETT (SWJ-792 új rendszám)")
inv("Drive IMG_5731", "in", "Bitu-express Kft.", "SZA01995/2026", "2026-10-21",
    [("Honosítás hatósági díjai (Áfa tv. hatályán kívül)", 44500, "TAH", "261", "MAZDA-CX5"),
     ("Honosítási eljárás előzetes átvizsgálás (M1)", 20758, "27", "261", "MAZDA-CX5")], [("2026-10-21", "381", 70865)], pm="cash",
    note="Gépkocsi hozzárendelés FELTÉTELEZETT (km 191 901); fizetve 70 865 (kerekítés 2 Ft)")
ent("Drive IMG_5731", "PE", "2026-10-21", "SZA01995/2026", "Kerekítés (fizetve 70 865, számla 70 863)", [("879", 2, 0), ("381", 0, 2)])
# FM Drive – olaj, szűrő
inv("Drive IMG_5729", "in", "FM Drive Auto Kft.", "FM-2026-3", "2026-10-13",
    [("Motorolaj", 11685, "27", "523"), ("Olajszűrő", 1216, "27", "523"), ("Olajleeresztő csavar", 410, "27", "523")], [("2026-10-13", "381", 16905)], pm="cash")
# Euronics – MacBook (tárgyi eszköz) + kiterjesztett garancia
inv("Drive IMG_5730", "in", "Vöröskő Kft. (Euronics)", "S26851-003049", "2026-10-28",
    [("Apple MacBook 13 (MBNEO13) – tárgyi eszköz", 236220, "27", "143"), ("Kiterjesztett garancia 1+4 év (0%)", 34999, "AM", "533")],
    [("2026-10-29", "384", 334998)], pm="card")
# Standard Color – fényszóró-felújító, csiszolópapír
inv("Drive IMG_5732", "in", "Standard Color Kft.", "SZ2403/2026", "2026-10-29",
    [("GERKO fényszóró-felújító készlet", 18000, "27", "523")], [("2026-10-29", "381", 22860)], pm="cash")
inv("Drive IMG_5733", "in", "Standard Color Kft.", "SZ2421/2026", "2026-10-30",
    [("APP vízpapír P800/P1000/P1500", 1132, "27", "523")], [("2026-10-30", "381", 1438)], pm="cash",
    note="Fizetve 1 435 (kerekítés); a számla ÁFA-ja 305, az app tételes kerekítéssel 306")
ent("Drive IMG_5733", "PE", "2026-10-30", "SZ2421/2026", "Kerekítés (fizetve 1 435, app szerinti bruttó 1 438)", [("381", 3, 0), ("979", 0, 3)])
# Fiat Punto – magánszemélytől, adásvételi
inv("Drive IMG_5735", "in", "Berkes Mónika", "AV-2026-10-30-KFH870", "2026-10-30",
    [("Fiat Punto KFH-870 – magánszemélytől vásárolt (adásvételi)", 550000, "KÜL27", "261", "PUNTO-KFH870")],
    [("2026-10-30", "381", 550000)], pm="cash", vehicle="PUNTO-KFH870")

# --- AUTO1 (EUR) – autó: különbözeti (§25a, M), díjak/fuvar: közösségi szolgáltatás (fordított, 27%) ---
inv("Gmail 90042601313395", "in", "AUTO1 European Cars B.V.", "90042601313395", "2026-10-26",
    [("Mitsubishi Colt 1.3 Invite HW19696 – különbözeti (§25a)", 326.00, "KÜL27", "261", "AUTO1-HW19696")],
    [("2026-10-26", "384", 326.00, 121063)], currency="EUR", vehicle="AUTO1-HW19696")
inv("Gmail 10026011169184", "in", "AUTO1 Group Operations SE", "10026011169184", "2026-10-26",
    [("Dokumentumkezelés HW19696", 159.00, "FAD27", "261", "AUTO1-HW19696"), ("Járműkezelés HW19696", 299.00, "FAD27", "261", "AUTO1-HW19696"),
     ("Aukciós díj HW19696", 155.00, "FAD27", "261", "AUTO1-HW19696")],
    [("2026-10-26", "384", 613.00, 227644)], currency="EUR")
inv("Gmail 10026011169101", "in", "AUTO1 Group Operations SE", "10026011169101", "2026-10-26",
    [("Fuvar Ketzin → Érd HW19696", 481.00, "FAD27", "261", "AUTO1-HW19696")],
    [("2026-10-26", "384", 481.00, 178624)], currency="EUR")
# November: fizetés a novemberi kivonattal kerül be (most nyitott)
inv("Gmail 90042601326027", "in", "AUTO1 European Cars B.V.", "90042601326027", "2026-11-05",
    [("Mitsubishi Lancer 1.6 Basis BC60679 – különbözeti (§25a)", 2725.00, "KÜL27", "261", "AUTO1-BC60679")], currency="EUR", vehicle="AUTO1-BC60679")
inv("Gmail 10026011214244", "in", "AUTO1 Group Operations SE", "10026011214244", "2026-11-05",
    [("Dokumentumkezelés BC60679", 159.00, "FAD27", "261", "AUTO1-BC60679"), ("Járműkezelés BC60679", 299.00, "FAD27", "261", "AUTO1-BC60679"),
     ("Aukciós díj BC60679", 580.00, "FAD27", "261", "AUTO1-BC60679"), ("Kupon V-X02006A", -200.00, "FAD27", "261", "AUTO1-BC60679")], currency="EUR")
inv("Gmail 90042601326033", "in", "AUTO1 European Cars B.V.", "90042601326033", "2026-11-05",
    [("Mitsubishi Lancer 1.6 ClearTec XTRA SK62311 – különbözeti (§25a)", 1743.00, "KÜL27", "261", "AUTO1-SK62311")], currency="EUR", vehicle="AUTO1-SK62311")
inv("Gmail 10026011214265", "in", "AUTO1 Group Operations SE", "10026011214265", "2026-11-05",
    [("Dokumentumkezelés SK62311", 159.00, "FAD27", "261", "AUTO1-SK62311"), ("Járműkezelés SK62311", 299.00, "FAD27", "261", "AUTO1-SK62311"),
     ("Aukciós díj SK62311", 488.00, "FAD27", "261", "AUTO1-SK62311"), ("Kupon V-X02006A", -200.00, "FAD27", "261", "AUTO1-SK62311")], currency="EUR")
inv("Gmail 10026011214222", "in", "AUTO1 Group Operations SE", "10026011214222", "2026-11-05",
    [("Fuvar Kandel → Érd SK62311", 470.00, "FAD27", "261", "AUTO1-SK62311")], currency="EUR")
log.append(["AUTO1 10026011214209 (BC60679 fuvar 456 EUR, 11.05.) és sztornója 10026020041203 (11.06.) – nettó 0, nem könyvelve"])

# --- Ismeretlen beszerzések ------------------------------------------------------------
for key, pur, label in [("LANCER-SWJ792", LANCER_SWJ_PURCHASE, "Lancer SWJ-792"), ("MAZDA-CX5", MAZDA_PURCHASE, "Mazda CX-5")]:
    if pur:
        if pur.get("private", True) and pur["partner"] not in partners:
            P(pur["partner"], private=True)
        fx = "priceFx" in pur
        amt = pur["priceFx"] if fx else pur["price"]
        inv(pur.get("src", "felhasználó"), "in", pur["partner"], pur.get("number", f"AV-{pur['date']}-{key}"), pur["date"],
            [(f"{label} beszerzés magánszemélytől – különbözeti, használt cikk", amt, "KÜL27", "261", key)],
            [(pur["date"], pur["account"], amt)] if pur.get("account") else [], pm="cash", vehicle=key,
            **({"currency": pur["currency"]} if fx else {}))
    else:
        log.append([f"HIÁNYZIK: {label} beszerzési bizonylata – a különbözeti ÁFA ezért a teljes eladási árból számolódik!"])

# ======================================================================================
# Vevőszámlák (számlázz.hu) – különbözeti adózás
# ======================================================================================
inv("szamlazz MM-2026-1", "out", "Nagy Csaba", "MM-2026-1", "2026-10-11",
    [("Mitsubishi Colt XMCXNZ33A9F055883 – különbözet szerinti szabályozás, használt cikkek", 1000000, "KÜL27", "911", "COLT-055883")],
    [("2026-10-11", "381", 1000000)], pm="cash", vehicle="COLT-055883", declaredVat=round((1000000 - 680000) * 27 / 127, 2))
inv("szamlazz E-MM-2026-1", "out", "Földesi András", "E-MM-2026-1", "2026-10-12",
    [("Mitsubishi Lancer SWJ-792 JMBSNCY2AAU000876 – különbözet szerinti szabályozás", 2200000, "KÜL27", "911", "LANCER-SWJ792")],
    [("2026-10-12", "381", 2200000)], pm="cash", vehicle="LANCER-SWJ792")
inv("szamlazz MM-2026-2", "out", "Berkes Mónika", "MM-2026-2", "2026-10-29",
    [("Mazda CX-5 JMZKEK97600108406 – különbözet szerinti szabályozás", 3950000, "KÜL27", "911", "MAZDA-CX5")],
    [("2026-10-29", "384", 450000), ("2026-10-30", "384", 3500000)], vehicle="MAZDA-CX5", dueDate="2026-10-31",
    note="450 000 foglaló 10.22-én érkezett (előleg), 3 500 000 vételárrész 10.30-án")

log += [
    ["Jegyzett tőke 3 000 000: Bálint 2 570 000 kp (08.01.) + 400 000 bank (08.25.), Márton 30 000 kp (08.01.) – 99%/1%"],
    ["PLACEHOLDER: Egzakt 2003 2×63 500 = 50 000 + 27% ÁFA könyvelési díj – számlák bekérendők"],
    ["FELTÉTELEZETT: 10.08. tagi kölcsön 54 393 Ft – különben a pénztár mínuszba menne a Bitu-számla kifizetésekor"],
    ["FELTÉTELEZETT: Mazda CX-5 beszerzés 10 000 EUR, 2026.08.15., a tagi kölcsönből (EUR pénztár)"],
    ["Berkes Mónika 450 000 foglaló 10.22. – a számla előtt érkezett; előlegszámla nem készült"],
    ["Évvégén: KBOSS előfizetés 2027-re eső része, KGFB elhatárolás, MacBook értékcsökkenés (143)"],
]

bundle = {"format": "mm-erp-import/1", "source": "MM Car Trade Kft – Gmail/Drive/számlázz.hu, 2026.08–11.",
          "partners": list(partners.values()), "vehicles": vehicles, "documents": docs, "log": log}
# dátum szerinti sorrend: a kiegyenlítések a számla után
order = {"invoice": 0, "entry": 1}
bundle["documents"].sort(key=lambda d: (d["date"], 0 if d["kind"] == "entry" and any(l["account"] == "4791" for l in d["lines"]) else 1))
json.dump(bundle, open(OUT, "w"), ensure_ascii=False, indent=1)
print(OUT, len(docs), "bizonylat,", len(vehicles), "gépkocsi,", len(partners), "partner")
