#!/usr/bin/env python3
"""
Ventes immobilières récentes (DVF géolocalisé, data.gouv.fr) — utilisé par robot.py.

Idée : quelqu'un qui vient d'acheter une maison (surtout si elle a été vendue moins cher
que la moyenne de la commune = maison à rénover) a souvent besoin de débarras, curage,
nettoyage puis d'artisans. Même chose pour les locaux commerciaux / industriels.

Limites des données :
  - la Moselle (57) n'est PAS publiée (régime du livre foncier d'Alsace-Moselle) ;
  - publication avec retard (2 fois par an) : on garde les 12 derniers mois DISPONIBLES.
Les ventes sont déjà géolocalisées (centre de la parcelle) : pas de géocodage.
"""
import csv
import datetime as dt
import gzip
import io
import statistics
import urllib.request

BASE = "https://files.data.gouv.fr/geo-dvf/latest/csv/{an}/departements/{dep}.csv.gz"
DEPS_DVF = ["54", "55", "88"]       # 57 absent de DVF
UA = {"User-Agent": "prospection-permis/1.0 (robot GitHub Actions)"}
NATURES = {"Vente", "Adjudication"}


def log(*a):
    print(*a, flush=True)


def telecharger(url):
    """Renvoie le contenu (décompressé) ou None si le fichier n'existe pas."""
    for essai in range(3):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=300) as r:
                return gzip.decompress(r.read()).decode("utf-8")
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
        except Exception as e:  # noqa: BLE001
            log(f"  (essai {essai + 1}) {url} : {e}")
    return None


def nombre(v):
    try:
        return float(str(v).replace(",", "."))
    except ValueError:
        return 0.0


def cle_parcelle(insee, section, numero):
    """Clé commune|section|numéro normalisée, pour relier une vente et un permis."""
    section = (section or "").strip().upper().lstrip("0")
    chiffres = "".join(c for c in str(numero or "") if c.isdigit())
    if not section or not chiffres:
        return ""
    return f"{insee}|{section}|{int(chiffres)}"


def lire_ventes():
    """Renvoie (liste de fiches « vente », date de la vente la plus récente)."""
    annee = dt.date.today().year
    lignes = []
    annees = []
    for an in range(annee, annee - 4, -1):
        if len(annees) == 2:
            break
        trouve = False
        for dep in DEPS_DVF:
            texte = telecharger(BASE.format(an=an, dep=dep))
            if texte is None:
                continue
            trouve = True
            lignes += list(csv.DictReader(io.StringIO(texte)))
        if trouve:
            annees.append(an)
    log(f"\n== Ventes DVF : années {sorted(annees)}, {len(lignes)} lignes (54, 55, 88)")

    # Une vente (mutation) = plusieurs lignes (une par bien / parcelle) : on regroupe
    mutations = {}
    for l in lignes:
        if l["nature_mutation"] not in NATURES:
            continue
        mutations.setdefault(l["id_mutation"], []).append(l)

    ventes = []
    for idm, ls in mutations.items():
        biens = {}  # (type, surface, pièces) → évite les doublons dus aux parcelles
        for l in ls:
            if l["type_local"] in ("Maison", "Local industriel. commercial ou assimilé", "Appartement"):
                biens[(l["type_local"], l["surface_reelle_bati"], l["nombre_pieces_principales"], l["lot1_numero"])] = l
        types = [b[0] for b in biens]
        nb_maisons = types.count("Maison")
        nb_locaux = types.count("Local industriel. commercial ou assimilé")
        # On garde : 1 maison (éventuellement avec dépendances), ou 1 à 2 locaux, sans appartement.
        # Les ventes en bloc (immeubles, lots de bailleurs) sont écartées.
        if "Appartement" in types or not (nb_maisons == 1 and nb_locaux == 0 or nb_maisons == 0 and 1 <= nb_locaux <= 2):
            continue
        bien = "maison" if nb_maisons else "local"
        principal = next(l for k, l in biens.items())
        surface = sum(nombre(k[1]) for k in biens)
        terrains = {(l["id_parcelle"], l["nature_culture"], l["surface_terrain"]) for l in ls if l["surface_terrain"]}
        terrain = sum(nombre(t[2]) for t in terrains)
        prix = nombre(principal["valeur_fonciere"])
        geo = next((l for l in ls if l["latitude"] and l["longitude"]), None)
        if not geo or prix <= 0:
            continue
        parcelles = sorted({l["id_parcelle"] for l in ls if l["id_parcelle"]})
        adr = " ".join(x for x in (principal["adresse_numero"], principal["adresse_suffixe"],
                                    principal["adresse_nom_voie"]) if x)
        v = {
            "id": f"V{idm}",
            "src": "V",
            "t": "VT",
            "num": idm,
            "e": 0,
            "da": principal["date_mutation"],
            "bien": bien,
            "nat_v": principal["nature_mutation"],
            "prix": int(prix),
            "sb": int(surface),
            "pp": int(nombre(principal["nombre_pieces_principales"])) if bien == "maison" else 0,
            "st": int(terrain),
            "dep": principal["code_departement"],
            "insee": principal["code_commune"],
            "adr": adr.upper(),
            "cp": principal["code_postal"],
            "ville": principal["nom_commune"].upper(),
            "cad": [f"{p[8:10].lstrip('0') or '0'} {int(p[10:])}" for p in parcelles[:6] if len(p) == 14],
            "lat": round(nombre(geo["latitude"]), 6),
            "lon": round(nombre(geo["longitude"]), 6),
            "geo": "a",
            "_parcelles": [cle_parcelle(p[:5], p[8:10], p[10:]) for p in parcelles if len(p) == 14],
        }
        if bien == "maison" and surface >= 20:
            v["pm2"] = round(prix / surface)
        ventes.append(v)

    # Prix au m² habituel de chaque commune (médiane, 5 ventes de maisons minimum)
    par_commune = {}
    for v in ventes:
        if v.get("pm2"):
            par_commune.setdefault(v["insee"], []).append(v["pm2"])
    par_dep = {}
    for v in ventes:
        if v.get("pm2"):
            par_dep.setdefault(v["dep"], []).append(v["pm2"])
    for v in ventes:
        if not v.get("pm2"):
            continue
        ref = par_commune.get(v["insee"], [])
        if len(ref) >= 5:
            v["med"] = round(statistics.median(ref))
        else:
            v["med"] = round(statistics.median(par_dep[v["dep"]]))
            v["med_dep"] = 1  # comparaison au département (trop peu de ventes dans la commune)
        v["ratio"] = round(v["pm2"] / v["med"], 2) if v["med"] else 0

    # On garde les 12 derniers mois disponibles
    if not ventes:
        return [], ""
    derniere = max(v["da"] for v in ventes)
    limite = (dt.date.fromisoformat(derniere) - dt.timedelta(days=365)).isoformat()
    ventes = [v for v in ventes if v["da"] > limite]
    log(f"  {len(ventes)} ventes gardées (maisons + locaux) du {limite} au {derniere}")
    return ventes, derniere


def lier_ventes_permis(permis, ventes):
    """Relie une vente et un permis sur la même parcelle : achat puis travaux = prospect idéal."""
    index = {}
    for v in ventes:
        for p in v["_parcelles"]:
            if p:
                index.setdefault(p, []).append(v)
    liens = 0
    for f in permis:
        for c in f.get("cad", []):
            morceaux = c.split(" ")
            if len(morceaux) != 2:
                continue
            for v in index.get(cle_parcelle(f.get("insee", ""), morceaux[0], morceaux[1]), []):
                if v["da"] <= f.get("da", "") or not f.get("da"):
                    f["achat"] = {"d": v["da"], "prix": v["prix"], "id": v["id"]}
                    v.setdefault("pc", []).append(f["id"])
                    liens += 1
    for v in ventes:
        v.pop("_parcelles", None)
    log(f"  {liens} liens vente → permis sur la même parcelle")
