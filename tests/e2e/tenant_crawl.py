"""Futtatás (éles build + tesztadatbázis mellett): find src/app -name page.tsx -o -name route.ts | sed ... > /tmp/routes.txt,
majd python3 tests/e2e/tenant_crawl.py [-v]. Az A_CIDS / B_CID / IDS / MARKERS értékeket a tesztadatbázishoz kell igazítani.

v7.0.0 – cégek közötti adatszivárgás-teszt: B felhasználó (másik ügyfélfiók) bejárja az összes oldalt
A cégeinek azonosítóival, és figyeli, megjelenik-e A bármely jellemző adata a válaszban."""
import re, sys
from playwright.sync_api import sync_playwright
B="http://localhost:3100"
A_CIDS=[38,1]; B_CID=37
IDS={"id":{"assets":"1","filings":"1","inbox":"1","inventory":"2","invoices":"35","journal":"72","vehicles":"1"},"entryId":"72","accountId":"587","period":"2026-10","doc":"aszf"}
MARKERS=["Mecsek Logisztika","Kovács és Társa","TITKOSMARKA","TITKOS-ESZKOZ","TITKOS-CIKK","Bemutató Autószerviz","Próba Kft","DEMO-20","Dráva Futár"]
routes=[l.strip() for l in open("/tmp/routes.txt") if l.strip()]
def fill(r,cid):
    seg=[s for s in r.split("/") if s]
    out=[]
    for i,s in enumerate(seg):
        if s=="[cid]": out.append(str(cid))
        elif s=="[id]": out.append(IDS["id"].get(seg[i-1],"1"))
        elif s.startswith("["): out.append(IDS.get(s[1:-1],"1"))
        else: out.append(s)
    return "/"+"/".join(out)
urls=set()
for r in routes:
    if "/api/stripe" in r or "/api/bank" in r or "/api/daily-summary" in r: continue
    if "[cid]" in r:
        for c in A_CIDS+[B_CID]: urls.add(fill(r,c))
    else: urls.add(fill(r,0))
leaks=[]; stat={}
with sync_playwright() as pw:
    br=pw.chromium.launch(executable_path="/usr/bin/google-chrome",args=["--no-sandbox"]); p=br.new_page()
    p.goto(B+"/login"); p.fill("input[name=email]","b@t.hu"); p.fill("input[name=password]","jelszo12345"); p.click("button.primary"); p.wait_for_timeout(3000)
    print("login →",p.url)
    req=p.context.request
    for u in sorted(urls):
        try: r=req.get(B+u, max_redirects=5, timeout=60000)
        except Exception as e: print("ERR",u,e); continue
        body=r.body().decode("utf8","ignore")
        hit=[m for m in MARKERS if m in body]
        stat[r.status]=stat.get(r.status,0)+1
        if hit: leaks.append((u,r.status,r.url,hit))
        fin=r.url.replace(B,"")
        if r.status==200 and any(fin.startswith(f"/c/{a}") or fin.startswith(f"/p/{a}") for a in A_CIDS): leaks.append((u,r.status,fin,["A cégének oldala megnyílt"]))
        if "-v" in sys.argv: print(r.status,u,"→",r.url.replace(B,""),hit)
    br.close()
print("státuszok:",stat)
print("SZIVÁRGÁS:",len(leaks))
for l in leaks: print("  ",l)
