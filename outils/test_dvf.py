#!/usr/bin/env python3
"""Test des données DVF géolocalisées (ventes immobilières) pour 54, 55, 57, 88.
Affiche : années disponibles, colonnes, volumes par type de bien et par mois, exemples."""
import collections
import csv
import gzip
import io
import os
import re
import urllib.request

BASE = "https://files.data.gouv.fr/geo-dvf/latest/csv/"
UA = {"User-Agent": "prospection-permis/1.0 (test DVF)"}
RESUME = os.environ.get("GITHUB_STEP_SUMMARY")
lignes = []


def dire(t=""):
    print(t, flush=True)
    lignes.append(t)


def lire(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=300) as r:
        return r.read()


dire("# Test DVF\n")
try:
    index = lire(BASE).decode("utf-8", "replace")
    dire("Début de la page d'index :\n```\n" + index[:1500] + "\n```")
except Exception as e:  # noqa: BLE001
    dire(f"Index illisible : {e}")
# On essaie directement les années récentes (fichier du 54)
annees = []
for an in range(2027, 2018, -1):
    try:
        req = urllib.request.Request(f"{BASE}{an}/departements/54.csv.gz", headers=UA, method="HEAD")
        urllib.request.urlopen(req, timeout=60)
        annees.append(str(an))
    except Exception as e:  # noqa: BLE001
        dire(f"- {an} : {e}")
annees.sort()
dire(f"\nAnnées disponibles : {annees}\n")
for dep in ["54", "55", "57", "88"]:
    dire(f"## Département {dep}")
    for an in annees[-2:]:
        url = f"{BASE}{an}/departements/{dep}.csv.gz"
        try:
            brut = lire(url)
        except Exception as e:  # noqa: BLE001
            dire(f"- {an} : **absent** ({e})")
            continue
        lecteur = csv.DictReader(io.TextIOWrapper(gzip.GzipFile(fileobj=io.BytesIO(brut)), encoding="utf-8"))
        mutations = {}
        types = collections.Counter()
        natures = collections.Counter()
        mois = collections.Counter()
        exemple = None
        for l in lecteur:
            natures[l["nature_mutation"]] += 1
            if l["type_local"]:
                types[l["type_local"]] += 1
            if l["type_local"] == "Maison" and l["nature_mutation"] == "Vente":
                mutations[l["id_mutation"]] = l
                mois[l["date_mutation"][:7]] += 1
                exemple = exemple or l
        dire(f"- {an} : {len(brut) / 1e6:.1f} Mo — ventes de maisons (mutations) : **{len(mutations)}**")
        dire(f"  - natures : {dict(natures.most_common(8))}")
        dire(f"  - types de locaux (lignes) : {dict(types.most_common())}")
        dire(f"  - par mois : {dict(sorted(mois.items()))}")
        if exemple and an == annees[-1]:
            dire(f"  - colonnes : {list(exemple.keys())}")
            dire(f"  - exemple : { {k: v for k, v in exemple.items() if v} }")
    dire()
if RESUME:
    with open(RESUME, "a", encoding="utf-8") as f:
        f.write("\n".join(lignes) + "\n")
