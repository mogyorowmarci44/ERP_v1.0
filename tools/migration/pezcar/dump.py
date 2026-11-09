import sys, csv, openpyxl, os
src, outdir = sys.argv[1], sys.argv[2]
os.makedirs(outdir, exist_ok=True)
wb = openpyxl.load_workbook(src, data_only=True, read_only=True, keep_vba=False)
for ws in wb.worksheets:
    name = ws.title.replace("/", "_").replace(" ", "_")
    with open(f"{outdir}/{name}.csv", "w", newline="") as f:
        w = csv.writer(f)
        for row in ws.iter_rows(values_only=True):
            vals = list(row)
            while vals and vals[-1] is None: vals.pop()
            w.writerow(["" if v is None else (v.isoformat()[:10] if hasattr(v, "isoformat") else v) for v in vals])
print("ok", outdir)
