import pandas as pd
pd.set_option("display.width", 250); pd.set_option("display.max_columns", 30); pd.set_option("display.max_colwidth", 24); pd.set_option("display.max_rows", 500)
def journal(year):
    j = pd.read_csv(f"/home/claude/pezcar-csv/{year}/Főkönyvi_Napló.csv", dtype=str).fillna("")
    j.columns = ["date","month","doc","partner","memo","td","tname","kd","kname","net","rate","vat","gross","pay","vattype","car"]
    for c in ["net","vat","gross","rate"]:
        j[c] = pd.to_numeric(j[c].str.replace(",", "."), errors="coerce").fillna(0)
    j["pat"] = (j.td.ne("").map({True:"T",False:"-"}) + j.kd.ne("").map({True:"K",False:"-"}))
    j["row"] = j.index + 2
    return j
