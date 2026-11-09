# PezCar Kft – migráció a régi Excel nyilvántartásból

A `PEZCAR_KFT_1.0_2025.xlsm` és `PEZCAR_KFT_1.0_2026.xlsm` munkafüzetekből készít `mm-erp-import/1` csomagot,
amit az app **Adatimport** oldalán (üres cégbe) lehet betölteni. Az adatfájlok nincsenek a repóban.

```bash
python3 dump.py PEZCAR_KFT_1.0_2025.xlsm ../pezcar-csv/2025      # munkalapok CSV-be
python3 dump.py PEZCAR_KFT_1.0_2026.xlsm ../pezcar-csv/2026
python3 convert.py bundle pezcar-import.json                     # import csomag
```

(A `load.py` és `convert.py` a CSV-k helyét a `/home/claude/pezcar-csv` útvonalon keresi – szükség esetén írd át.)

Főbb átalakítási szabályok (részletesen a `convert.py` fejlécében és az import csomag `log` mezőjében):

- A régi főkönyvi kivonat nettó/nettó elven számolt (a pénz csak a nettóval csökkent). Az új könyvelés bruttó kiegyenlítéssel dolgozik,
  a nem levonható ÁFA a költség / készlet része, a levonható a 466-on.
- Különbözeti eladások vevőszámlaként, gépkocsihoz kötve; a különbözeti ÁFA alapja a nyilvántartás szerinti beszerzési ár (azonos a bevallottal).
- ELÁBÉ az app könyv szerinti értékéből (beszerzés + aktivált ráfordítások + foglaló).
- Kihagyva: 2026-os évnyitás (a 2025-ös tételekből adódik), „Forecast” eladások, mai napnál későbbi tételek,
  a régi nettó-elv miatti év végi ÁFA-átvezetések.
