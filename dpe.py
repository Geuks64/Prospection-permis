#!/usr/bin/env python3
"""
Diagnostics de performance énergétique récents (DPE, ADEME) — utilisé par robot.py.

Idée : un DPE tout récent sur une maison = souvent une maison mise en vente ou en location
(le DPE est obligatoire dans ces cas). Les maisons classées F ou G (« passoires thermiques »)
ont en plus des travaux de rénovation énergétique à faire (location interdite en G depuis 2025,
en F à partir de 2028). Pour HO : débarras / curage / nettoyage + artisans.

Données publiées en continu (quelques jours de retard), adresses déjà géolocalisées.
API ouverte data-fair de l'ADEME, jeu « dpe03existant » (DPE des logements existants).
"""
import datetime as dt
import json
import urllib.parse
import urllib.request

API = "https://data.ademe.fr/data-fair/api/v1/datasets/dpe03existant/lines"
UA = {"User-Agent": "prospection-permis/1.0 (robot GitHub Actions)"}
DEPS = ["54", "55", "57", "88"]
JOURS = 120                     # DPE de moins de 4 mois
ETIQUETTES = ["D", "E", "F", "G"]
CHAMPS = [
    "numero_dpe", "numero_dpe_remplace", "date_etablissement_dpe", "date_fin_validite_dpe",
    "etiquette_dpe", "etiquette_ges", "type_batiment", "annee_construction", "periode_construction",
    "surface_habitable_logement", "nombre_niveau_logement", "numero_voie_ban", "nom_rue_ban",
    "adresse_brut", "code_postal_ban", "nom_commune_ban", "code_insee_ban", "code_departement_ban",
    "identifiant_ban", "score_ban", "statut_geocodage", "_geopoint",
    "type_energie_principale_chauffage", "qualite_isolation_enveloppe", "cout_total_5_usages",
]


def log(*a):
    print(*a, flush=True)


def get(url):
    for essai in range(4):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.load(r)
        except Exception as e:  # noqa: BLE001
            log(f"  (essai {essai + 1}) {e}")
    raise RuntimeError("API DPE injoignable")


def lire_dpe():
    """Renvoie (liste de fiches « DPE », date du DPE le plus récent)."""
    depuis = (dt.date.today() - dt.timedelta(days=JOURS)).isoformat()
    brut = []
    for dep in DEPS:
        qs = (f'code_departement_ban:"{dep}" AND type_batiment:"maison" '
              f'AND date_etablissement_dpe:[{depuis} TO *] AND etiquette_dpe:({" OR ".join(ETIQUETTES)})')
        url = API + "?" + urllib.parse.urlencode({"qs": qs, "size": 2000, "select": ",".join(CHAMPS)})
        n = 0
        while url:
            page = get(url)
            brut += page.get("results", [])
            n += len(page.get("results", []))
            url = page.get("next")           # page suivante (pagination de l'API)
        log(f"  DPE {dep} : {n} maisons")

    # Un DPE peut en remplacer un autre, et une maison peut avoir plusieurs DPE : on garde le dernier
    remplaces = {d.get("numero_dpe_remplace") for d in brut if d.get("numero_dpe_remplace")}
    par_adresse = {}
    for d in brut:
        if d.get("numero_dpe") in remplaces or not d.get("_geopoint"):
            continue
        cle = d.get("identifiant_ban") or d.get("numero_dpe")
        if cle not in par_adresse or d["date_etablissement_dpe"] > par_adresse[cle]["date_etablissement_dpe"]:
            par_adresse[cle] = d

    fiches = []
    for d in par_adresse.values():
        lat, lon = (float(x) for x in d["_geopoint"].split(","))
        adr = " ".join(x for x in (str(d.get("numero_voie_ban") or ""), d.get("nom_rue_ban") or "") if x) \
            or (d.get("adresse_brut") or "")
        geo = "a" if "adresse" in (d.get("statut_geocodage") or "") and (d.get("score_ban") or 0) >= 0.5 else "r"
        f = {
            "id": f"E{d['numero_dpe']}",
            "src": "E",
            "t": "DPE",
            "num": d["numero_dpe"],
            "e": 0,
            "da": d["date_etablissement_dpe"],
            "etq": d.get("etiquette_dpe", ""),
            "ges": d.get("etiquette_ges", ""),
            "an": int(d["annee_construction"]) if d.get("annee_construction") else 0,
            "per": d.get("periode_construction", ""),
            "sb": int(float(d.get("surface_habitable_logement") or 0)),
            "niv": int(d.get("nombre_niveau_logement") or 0),
            "chauf": d.get("type_energie_principale_chauffage", ""),
            "iso": d.get("qualite_isolation_enveloppe", ""),
            "cout": int(float(d.get("cout_total_5_usages") or 0)),
            "fin": d.get("date_fin_validite_dpe", ""),
            "dep": d.get("code_departement_ban", ""),
            "insee": d.get("code_insee_ban", ""),
            "adr": adr.upper(),
            "cp": d.get("code_postal_ban", ""),
            "ville": (d.get("nom_commune_ban") or "").upper(),
            "lat": round(lat, 6),
            "lon": round(lon, 6),
            "geo": geo,
        }
        fiches.append({k: v for k, v in f.items() if v not in ("", None) or k == "e"})
    derniere = max((f["da"] for f in fiches), default="")
    log(f"  {len(fiches)} maisons avec un DPE D à G de moins de {JOURS} jours (dernier : {derniere})")
    return fiches, derniere


def lier_dpe(dpe, autres):
    """Signale un permis ou une vente à la même adresse (à ~25 m près, même commune)."""
    grille = {}
    for f in autres:
        if f.get("lat") is None or f.get("geo") != "a":
            continue
        grille.setdefault((round(f["lat"], 3), round(f["lon"], 3)), []).append(f)
    liens = 0
    for d in dpe:
        cle = (round(d["lat"], 3), round(d["lon"], 3))
        for f in grille.get(cle, []):
            if f.get("insee") == d.get("insee") and abs(f["lat"] - d["lat"]) < 0.00025 and abs(f["lon"] - d["lon"]) < 0.00035:
                d.setdefault("lies", []).append(f["id"])
                liens += 1
    log(f"  {liens} DPE à la même adresse qu'un permis ou une vente")
