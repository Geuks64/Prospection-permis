#!/usr/bin/env python3
"""Affiche les dictionnaires des variables Sitadel (signification des codes) dans le journal."""
import io
import urllib.request

import pandas as pd

FICHIERS = {
    "logements": "https://data.statistiques.developpement-durable.gouv.fr/dido/api/files/ab799b04-0b03-4f96-949c-eb23c478a8e8",
    "locaux": "https://data.statistiques.developpement-durable.gouv.fr/dido/api/files/38ca96c1-c8af-42db-bba1-13cd4bc713f3",
    "demolir": "https://data.statistiques.developpement-durable.gouv.fr/dido/api/files/fafd6542-ecc2-4ee3-9130-f17f7de8da09",
}
pd.set_option("display.max_rows", None, "display.max_columns", None, "display.width", 250,
              "display.max_colwidth", 200)
for nom, url in FICHIERS.items():
    req = urllib.request.Request(url, headers={"User-Agent": "prospection-permis/0.1"})
    data = urllib.request.urlopen(req, timeout=120).read()
    print(f"\n######## {nom} ({len(data)} octets)")
    for feuille, df in pd.read_excel(io.BytesIO(data), sheet_name=None).items():
        print(f"\n==== feuille : {feuille}")
        print(df.fillna("").to_string())
