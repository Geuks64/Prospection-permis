#!/usr/bin/env python3
"""
Robot de collecte — Étape 1.

Télécharge les 4 fichiers Sitadel (France entière), garde les départements visés et les
12 derniers mois, place chaque adresse sur la carte (géocodage IGN) et écrit le fichier
que l'appli affiche : public/data/permis.json.

Fichiers gardés dans le dépôt d'une fois sur l'autre :
  - donnees/geocache.json : adresses déjà géocodées (évite de tout refaire chaque mois) ;
  - donnees/vus.json      : date à laquelle chaque dossier a été vu pour la 1re fois
                            (sert à afficher les « nouveautés » dans l'appli).

Aucune dépendance : seulement la bibliothèque standard de Python.
Lancé par .github/workflows/robot.yml (2 fois par mois + bouton « Run workflow »).
"""
import concurrent.futures
import csv
import datetime as dt
import io
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

from dpe import lier_dpe, lire_dpe
from ventes import lier_ventes_permis, lire_ventes

# ---------------------------------------------------------------------------
# Réglages
# ---------------------------------------------------------------------------
DEPS = {"54", "55", "57", "88"}           # départements à prospecter
JOURS = 365                               # profondeur : 12 derniers mois
SORTIE = "public/data/permis.json"        # fichier lu par l'appli
CACHE_GEO = "donnees/geocache.json"
VUS = "donnees/vus.json"
CACHE_ENT = "donnees/entreprises.json"
UA = {"User-Agent": "prospection-permis/1.0 (robot GitHub Actions)"}

DIDO = "https://data.statistiques.developpement-durable.gouv.fr/dido/api/v1/datafiles/{}/csv"
# Les 4 fichiers Sitadel (identifiants stables de l'API DiDo du ministère).
# source : L = logements, N = locaux non résidentiels, D = permis de démolir, A = permis d'aménager
FICHIERS = [
    ("L", "8b35affb-55fc-4c1f-915b-7750f974446a", "autorisations créant des logements"),
    ("N", "f8f0700f-806c-40a7-83b1-f21cf507e7c4", "autorisations créant des locaux non résidentiels"),
    ("D", "1a9a2f0c-56fe-4e69-84a7-fbbda2121f02", "permis de démolir"),
    ("A", "96883f50-538b-41f9-a059-c6eb97e6a23a", "permis d'aménager"),
]
GEO = "https://data.geopf.fr/geocodage/search"   # géocodeur gratuit de l'IGN (Géoplateforme)


def log(*a):
    print(*a, flush=True)


# ---------------------------------------------------------------------------
# Téléchargement
# ---------------------------------------------------------------------------
def telecharger(url, chemin):
    """Télécharge un (gros) fichier sur le disque, avec 4 tentatives."""
    for essai in range(4):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=600) as r, open(chemin, "wb") as f:
                while bloc := r.read(1 << 20):
                    f.write(bloc)
            return os.path.getsize(chemin)
        except Exception as e:  # noqa: BLE001 - on réessaie
            log(f"  (essai {essai + 1}) téléchargement échoué : {e}")
            time.sleep(5 * 2 ** essai)
    raise RuntimeError(f"Téléchargement impossible : {url}")


# ---------------------------------------------------------------------------
# Lecture et mise en forme d'une ligne Sitadel
# ---------------------------------------------------------------------------
def entier(v):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return 0


def vrai(v):
    return str(v).strip().lower() in ("true", "1", "oui")


def nettoyer(v):
    return " ".join((v or "").split())


def convertir(source, l):
    """Transforme une ligne brute (dict) en fiche compacte pour l'appli."""
    num = l.get("NUM_DAU") or l.get("NUM_PD") or l.get("NUM_PA") or ""
    etat = l.get("ETAT_DAU") or l.get("ETAT_PD") or l.get("ETAT_PA") or ""
    typ = l.get("TYPE_DAU") or {"D": "PD", "A": "PA"}.get(source, "")
    cadastre = []
    for i in range(1, 26):
        s, n = nettoyer(l.get(f"SEC_CADASTRE{i}")), nettoyer(l.get(f"NUM_CADASTRE{i}"))
        if s or n:
            cadastre.append(f"{s} {n}".strip())
    # Annexes / particularités du projet (servent aux filtres « piscine », « garage »…)
    options = []
    for col, nom in (("I_PISCINE", "piscine"), ("I_GARAGE", "garage"), ("I_VERANDA", "veranda"),
                     ("I_ABRI_JARDIN", "abri"), ("I_EXTENSION", "extension"),
                     ("I_SURELEVATION", "surelevation"), ("I_NIVSUPP", "niveau")):
        if vrai(l.get(col)):
            options.append(nom)
    if vrai(l.get("AGRIVOLTAIQUE")):
        options.append("photovoltaique")
    fiche = {
        "id": f"{typ}{num}",
        "src": source,
        "t": typ,
        "num": num,
        "e": entier(etat),
        "da": l.get("DATE_REELLE_AUTORISATION", ""),
        "dd": l.get("DATE_REELLE_DOC", ""),
        "df": l.get("DATE_REELLE_DAACT", ""),
        "dep": (l.get("DEP_CODE") or "").zfill(2),
        "insee": l.get("COMM", ""),
        "adr": nettoyer(f"{l.get('ADR_NUM_TER', '')} {l.get('ADR_LIBVOIE_TER', '')}"),
        "ld": nettoyer(l.get("ADR_LIEUDIT_TER")),
        "cp": nettoyer(l.get("ADR_CODPOST_TER")),
        "ville": nettoyer(l.get("ADR_LOCALITE_TER")),
        "dem": nettoyer(l.get("DENOM_DEM")),
        "siret": nettoyer(l.get("SIRET_DEM")),
        "ape": nettoyer(l.get("APE_DEM")),
        "dcp": nettoyer(l.get("CODPOST_DEM")),
        "dville": nettoyer(l.get("LOCALITE_DEM")),
        "cad": cadastre[:6],
        "st": entier(l.get("SUPERFICIE_TERRAIN")),
        "nat": entier(l.get("NATURE_PROJET_COMPLETEE") or l.get("NATURE_PROJET_DECLAREE")),
        "dest": entier(l.get("DESTINATION_PRINCIPALE")),
        "tl": entier(l.get("TYPE_PRINCIP_LOGTS_CREES")),
        "lg": entier(l.get("NB_LGT_TOT_CREES")),
        "sh": entier(l.get("SURF_HAB_CREEE")),
        "sl": entier(l.get("SURF_LOC_CREEE")),
        "ut": entier(l.get("UTILISATION")),
        "rp": entier(l.get("RES_PRINCIP_OU_SECOND")),
        "niv": entier(l.get("NB_NIV_MAX")),
        "opt": options,
        # Pour la note « intérêt HO » : transformation, surfaces existantes et démolies
        "tt": entier(l.get("TYPE_TRANSFO_PRINCIPAL")),
        "sav": sum(entier(l.get(c)) for c in ("SURF_HAB_AVANT", "SURF_LOC_AVANT")),
        "sdem": sum(entier(l.get(c)) for c in ("SURF_HAB_DEMOLIE", "SURF_LOC_DEMOLIE")),
        "ldem": entier(l.get("NB_LGT_DEMOLIS")),
        "cj": nettoyer(l.get("CJ_DEM")),
    }
    # On retire les champs vides pour alléger le fichier
    return {k: v for k, v in fiche.items() if v not in ("", 0, [], None) or k in ("e",)}


def lire(source, rid, titre, limite):
    """Télécharge un fichier Sitadel et renvoie les fiches gardées (départements + période)."""
    chemin = f"/tmp/sitadel_{source}.csv"
    log(f"\n== {titre}")
    taille = telecharger(DIDO.format(rid), chemin)
    log(f"  téléchargé : {taille / 1e6:.0f} Mo")
    fiches = []
    total = 0
    with open(chemin, encoding="utf-8-sig", errors="replace", newline="") as f:
        lecteur = csv.reader(f, delimiter=";")
        entetes = next(lecteur)
        i_dep = entetes.index("DEP_CODE")
        i_date = entetes.index("DATE_REELLE_AUTORISATION")
        for ligne in lecteur:
            total += 1
            if ligne[i_dep].strip().zfill(2) not in DEPS or ligne[i_date][:10] < limite:
                continue
            fiche = convertir(source, dict(zip(entetes, ligne)))
            if fiche["e"] == 4:      # 4 = autorisation annulée : sans intérêt
                continue
            fiches.append(fiche)
    os.remove(chemin)
    log(f"  {total:,} lignes France → {len(fiches):,} gardées".replace(",", " "))
    return fiches


# ---------------------------------------------------------------------------
# Géocodage (adresse → latitude / longitude)
# ---------------------------------------------------------------------------
def requete_geo(params):
    url = GEO + "?" + urllib.parse.urlencode(params)
    for essai in range(4):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=30) as r:
                feats = json.load(r).get("features") or []
                return feats[0] if feats else None
        except urllib.error.HTTPError as e:
            if e.code == 429:      # trop de requêtes : on patiente
                time.sleep(2 + 2 * essai)
                continue
            if e.code == 400:
                return None
            time.sleep(1 + essai)
        except Exception:  # noqa: BLE001
            time.sleep(1 + essai)
    raise RuntimeError("géocodeur injoignable")


def geocoder(cle):
    """cle = 'adresse|code INSEE|ville'. Renvoie [lat, lon, précision] (précision 'a' adresse,
    'r' rue, 'c' commune) ou None."""
    adresse, insee, ville = cle.split("|")
    if adresse:
        feat = requete_geo({"q": adresse, "citycode": insee, "limit": 1}) if insee else None
        if not feat:
            feat = requete_geo({"q": f"{adresse} {ville}", "limit": 1})
        if feat and feat["properties"].get("score", 0) >= 0.4:
            lon, lat = feat["geometry"]["coordinates"]
            typ = feat["properties"].get("type")
            precision = "a" if typ == "housenumber" else ("r" if typ in ("street", "locality") else "c")
            return [round(lat, 6), round(lon, 6), precision]
    # Pas d'adresse exploitable : centre de la commune
    feat = requete_geo({"q": ville or insee, "citycode": insee, "type": "municipality", "limit": 1}) \
        if insee else None
    if feat:
        lon, lat = feat["geometry"]["coordinates"]
        return [round(lat, 6), round(lon, 6), "c"]
    return None


def cle_geo(f):
    adresse = " ".join(x for x in (f.get("adr", ""), f.get("ld", "")) if x)
    return f"{adresse}|{f.get('insee', '')}|{f.get('ville', '')}"


def geocoder_tout(fiches):
    cache = charger(CACHE_GEO, {})
    a_faire = sorted({cle_geo(f) for f in fiches} - cache.keys())
    log(f"\n== Géocodage : {len(a_faire)} nouvelles adresses ({len(cache)} déjà connues)")
    erreurs = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        futurs = {pool.submit(geocoder, c): c for c in a_faire}
        for n, fut in enumerate(concurrent.futures.as_completed(futurs), 1):
            try:
                cache[futurs[fut]] = fut.result()
            except Exception:  # noqa: BLE001 - réessayé au prochain passage du robot
                erreurs += 1
            if n % 500 == 0:
                log(f"  {n}/{len(a_faire)}")
    if erreurs:
        log(f"  {erreurs} adresses en échec (réessayées la prochaine fois)")
    # On ne garde dans le cache que les adresses encore utiles (le fichier reste léger)
    utiles = {cle_geo(f) for f in fiches}
    cache = {k: v for k, v in cache.items() if k in utiles}
    ecrire(CACHE_GEO, cache)
    places = 0
    for f in fiches:
        pos = cache.get(cle_geo(f))
        if pos:
            f["lat"], f["lon"], f["geo"] = pos
            places += 1
    log(f"  {places}/{len(fiches)} dossiers placés sur la carte")


# ---------------------------------------------------------------------------
# Sociétés : adresse du siège + dirigeant (annuaire officiel, gratuit, sans clé)
# ---------------------------------------------------------------------------
ANNUAIRE = "https://recherche-entreprises.api.gouv.fr/search"


def chercher_entreprise(siren):
    """Renvoie {nom, adr, dir, ok} pour un SIREN, ou {} si introuvable."""
    url = ANNUAIRE + "?" + urllib.parse.urlencode({"q": siren, "per_page": 1, "page": 1})
    for essai in range(5):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=30) as r:
                res = (json.load(r).get("results") or [])
            break
        except urllib.error.HTTPError as e:
            if e.code == 429:            # limite : 7 requêtes / seconde
                time.sleep(2 + 2 * essai)
                continue
            if e.code in (400, 404):
                return {}
            time.sleep(1 + essai)
        except Exception:  # noqa: BLE001
            time.sleep(1 + essai)
    else:
        raise RuntimeError("annuaire injoignable")
    res = [x for x in res if x.get("siren") == siren]
    if not res:
        return {}
    e = res[0]
    siege = e.get("siege") or {}
    dirigeant = ""
    for d in e.get("dirigeants") or []:
        if d.get("type_dirigeant") == "personne physique" and d.get("nom"):
            prenom = (d.get("prenoms") or "").split(" ")[0].title()
            dirigeant = f"{prenom} {d['nom'].upper()}".strip()
            if d.get("qualite"):
                dirigeant += f" ({d['qualite']})"
            break
    return {
        "nom": e.get("nom_complet", ""),
        "adr": siege.get("adresse", ""),
        "dir": dirigeant,
        "actif": e.get("etat_administratif", "A") == "A",
    }


def enrichir_societes(fiches):
    cache = charger(CACHE_ENT, {})
    sirens = sorted({f["siret"][:9] for f in fiches if len(f.get("siret", "")) >= 9})
    a_faire = [s for s in sirens if s not in cache]
    log(f"\n== Annuaire des entreprises : {len(a_faire)} sociétés à chercher ({len(cache)} déjà connues)")
    erreurs = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        futurs = {}
        for s in a_faire:
            futurs[pool.submit(chercher_entreprise, s)] = s
            time.sleep(0.15)                  # reste sous la limite de 7 requêtes / seconde
        for fut in concurrent.futures.as_completed(futurs):
            try:
                cache[futurs[fut]] = fut.result()
            except Exception:  # noqa: BLE001 - réessayé au prochain passage
                erreurs += 1
    if erreurs:
        log(f"  {erreurs} sociétés en échec (réessayées la prochaine fois)")
    cache = {k: v for k, v in cache.items() if k in set(sirens)}
    ecrire(CACHE_ENT, cache)
    for f in fiches:
        info = cache.get(f.get("siret", "")[:9])
        if info:
            f["ent"] = {k: v for k, v in info.items() if v not in ("", None)}


# ---------------------------------------------------------------------------
# Fichiers JSON du dépôt
# ---------------------------------------------------------------------------
def charger(chemin, defaut):
    try:
        with open(chemin, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return defaut


def ecrire(chemin, data, compact=False):
    os.makedirs(os.path.dirname(chemin), exist_ok=True)
    with open(chemin, "w", encoding="utf-8") as f:
        if compact:
            json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        else:
            json.dump(data, f, ensure_ascii=False, indent=0, sort_keys=True)


# ---------------------------------------------------------------------------
def main():
    aujourd_hui = dt.date.today()
    limite = (aujourd_hui - dt.timedelta(days=JOURS)).isoformat()
    log(f"Robot de collecte — départements {sorted(DEPS)} — autorisations depuis le {limite}")

    fiches = []
    for source, rid, titre in FICHIERS:
        fiches += lire(source, rid, titre, limite)
    if not fiches:
        log("Aucun dossier récupéré : on garde l'ancien fichier.")
        sys.exit(1)

    # Un même dossier peut apparaître dans 2 fichiers (logements + locaux) : on fusionne
    uniques = {}
    for f in fiches:
        if f["id"] in uniques:
            ancien = uniques[f["id"]]
            ancien["src"] = "".join(sorted(set(ancien["src"] + f["src"])))
            for k, v in f.items():
                ancien.setdefault(k, v)
        else:
            uniques[f["id"]] = f
    fiches = sorted(uniques.values(), key=lambda f: f.get("da", ""), reverse=True)

    geocoder_tout(fiches)
    enrichir_societes(fiches)

    # Ventes immobilières récentes (DVF) : 2e source de prospects
    try:
        ventes, derniere_vente = lire_ventes()
        lier_ventes_permis(fiches, ventes)
    except Exception as e:  # noqa: BLE001 - les permis restent publiés même si DVF est en panne
        log(f"  ⚠️ Ventes DVF indisponibles : {e}")
        ventes, derniere_vente = [], ""

    # Diagnostics énergie récents (DPE) : 3e source de prospects
    try:
        log("\n== DPE récents (ADEME)")
        dpes, dernier_dpe = lire_dpe()
        lier_dpe(dpes, fiches + ventes)
    except Exception as e:  # noqa: BLE001 - le reste est publié même si l'API DPE est en panne
        log(f"  ⚠️ DPE indisponibles : {e}")
        dpes, dernier_dpe = [], ""

    # Date de première apparition (pour les « nouveautés »)
    vus = charger(VUS, {})
    premiere_fois = not vus
    for f in fiches:
        f["vu"] = vus.setdefault(f["id"], aujourd_hui.isoformat())
    # 1re fois que les ventes arrivent : on ne les affiche pas toutes comme « nouvelles »
    premieres_ventes = not any(k.startswith("V") for k in vus)
    for v in ventes:
        v["vu"] = vus.setdefault(v["id"], v["da"] if premieres_ventes else aujourd_hui.isoformat())
    fiches += sorted(ventes, key=lambda v: v["da"], reverse=True)
    # 1re fois que les DPE arrivent : idem
    premiers_dpe = not any(k.startswith("E") for k in vus)
    for d in dpes:
        d["vu"] = vus.setdefault(d["id"], d["da"] if premiers_dpe else aujourd_hui.isoformat())
    fiches += sorted(dpes, key=lambda d: d["da"], reverse=True)
    ids = {f["id"] for f in fiches}
    ecrire(VUS, {k: v for k, v in vus.items() if k in ids})

    # (certaines dates saisies sont dans le futur : on les ignore pour la date affichée)
    dates = sorted(f["da"] for f in fiches if f.get("da") and f["da"] <= aujourd_hui.isoformat() and f["src"] not in ("V", "E"))
    resultat = {
        "maj": aujourd_hui.isoformat(),
        "depuis": limite,
        "derniere_autorisation": dates[-1] if dates else "",
        "premier_passage": premiere_fois,
        "derniere_vente": derniere_vente,
        "dernier_dpe": dernier_dpe,
        "permis": fiches,
    }
    ecrire(SORTIE, resultat, compact=True)
    taille = os.path.getsize(SORTIE) / 1e6
    log(f"\n== Terminé : {len(fiches)} dossiers → {SORTIE} ({taille:.1f} Mo)")

    resume = os.environ.get("GITHUB_STEP_SUMMARY")
    if resume:
        par_type = {}
        for f in fiches:
            par_type[f["t"]] = par_type.get(f["t"], 0) + 1
        nouveaux = sum(1 for f in fiches if f["vu"] == aujourd_hui.isoformat())
        with open(resume, "a", encoding="utf-8") as r:
            r.write(f"### Robot de collecte\n- **{len(fiches)} dossiers** (autorisés depuis le {limite})\n"
                    f"- Par type : {par_type}\n- Nouveaux aujourd'hui : {nouveaux}\n"
                    f"- Dernière autorisation dans les données : {resultat['derniere_autorisation']}\n"
                    f"- Placés sur la carte : {sum(1 for f in fiches if 'lat' in f)}\n"
                    f"- Ventes DVF (maisons + locaux) : {len(ventes)} (jusqu'au {derniere_vente or '—'})\n"
                    f"- DPE récents (maisons D à G) : {len(dpes)} (jusqu'au {dernier_dpe or '—'})\n")


if __name__ == "__main__":
    main()
