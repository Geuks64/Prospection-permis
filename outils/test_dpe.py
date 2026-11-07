#!/usr/bin/env python3
"""Test des DPE (diagnostics de performance énergétique, ADEME) pour 54, 55, 57, 88.
Affiche : jeux de données trouvés, liste des champs, volumes récents par département,
étiquettes, types de bâtiments, exemple de ligne."""
import collections
import json
import os
import urllib.parse
import urllib.request

API = "https://data.ademe.fr/data-fair/api/v1/datasets"
UA = {"User-Agent": "prospection-permis/1.0 (test DPE)"}
RESUME = os.environ.get("GITHUB_STEP_SUMMARY")
lignes = []


def dire(t=""):
    print(t, flush=True)
    lignes.append(t)


def get(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


dire("# Test DPE (ADEME)\n")
# 1) Jeux de données « dpe » disponibles
try:
    d = get(f"{API}?q=dpe&size=20&select=id,title,count,updatedAt")
    for x in d.get("results", []):
        dire(f"- `{x.get('id')}` — {x.get('title')} — {x.get('count')} lignes — maj {str(x.get('updatedAt'))[:10]}")
except Exception as e:  # noqa: BLE001
    dire(f"Liste des jeux impossible : {e}")

ID = "dpe03existant"
dire(f"\n## Jeu `{ID}`")
meta = get(f"{API}/{ID}")
champs = [c["key"] for c in meta.get("schema", [])]
dire(f"- {meta.get('count')} lignes, mis à jour le {str(meta.get('updatedAt'))[:10]}")
dire(f"- {len(champs)} champs :\n```\n{', '.join(champs)}\n```")


def champ(*candidats):
    for c in candidats:
        if c in champs:
            return c
    for c in champs:
        if all(m in c.lower() for m in candidats[0].lower().split("|")):
            return c
    return None


f_dep = champ("code_departement_ban")
f_date = champ("date_etablissement_dpe")
f_etiq = champ("etiquette_dpe")
f_type = champ("type_batiment")
dire(f"- champs repérés : dep={f_dep}, date={f_date}, étiquette={f_etiq}, type={f_type}")

for dep in ["54", "55", "57", "88"]:
    qs = f'{f_dep}:"{dep}" AND {f_date}:[2026-08-01 TO *]'
    url = f"{API}/{ID}/lines?" + urllib.parse.urlencode({"qs": qs, "size": 0})
    try:
        n = get(url).get("total")
        agg = {}
        for f in (f_etiq, f_type):
            u = f"{API}/{ID}/values_agg?" + urllib.parse.urlencode({"qs": qs, "field": f, "agg_size": 10})
            agg[f] = {b["value"]: b["total"] for b in get(u).get("aggs", [])}
        dire(f"\n### {dep} : {n} DPE depuis le 01/08/2026")
        dire(f"- étiquettes : {agg[f_etiq]}")
        dire(f"- types : {agg[f_type]}")
    except Exception as e:  # noqa: BLE001
        dire(f"\n### {dep} : erreur {e}")

# Date la plus récente + exemple de maison G
u = f"{API}/{ID}/lines?" + urllib.parse.urlencode({"qs": f'{f_dep}:"54"', "sort": f"-{f_date}", "size": 1})
dern = get(u).get("results", [{}])[0]
dire(f"\nDPE le plus récent (54) : {dern.get(f_date)}")
u = f"{API}/{ID}/lines?" + urllib.parse.urlencode({"qs": f'{f_dep}:"54" AND {f_type}:"maison" AND {f_etiq}:"G"', "sort": f"-{f_date}", "size": 1})
ex = get(u).get("results", [{}])[0]
dire("Exemple (maison G, 54) :\n```\n" + json.dumps({k: v for k, v in ex.items() if v not in (None, "")}, ensure_ascii=False, indent=1)[:6000] + "\n```")
if RESUME:
    with open(RESUME, "a", encoding="utf-8") as f:
        f.write("\n".join(lignes) + "\n")
