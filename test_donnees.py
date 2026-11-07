#!/usr/bin/env python3
"""
Étape 0 — Test des données Sitadel (permis de construire, permis de démolir,
permis d'aménager, déclarations préalables) publiées en open data sur data.gouv.fr.

But : avant d'écrire le vrai robot, vérifier sur les départements visés
  - quels fichiers existent et à quelle date ils ont été mis à jour ;
  - quelles colonnes ils contiennent (avec un exemple de valeur pour chacune) ;
  - combien de dossiers par type et par mois ;
  - si l'adresse du chantier est remplie pour les particuliers ;
  - si le géocodage (adresse → point sur la carte) fonctionne.

Aucune dépendance : seulement la bibliothèque standard de Python.
Le résultat s'affiche dans le journal du workflow et dans le résumé du run GitHub Actions.
"""
import collections
import csv
import io
import json
import os
import sys
import time
import urllib.parse
import urllib.request
import zipfile

# Départements à prospecter (54 Meurthe-et-Moselle, 55 Meuse, 57 Moselle, 88 Vosges)
DEPS = {"54", "55", "57", "88"}

API = "https://www.data.gouv.fr/api/1"
# Identifiant (« slug ») probable du jeu de données Sitadel « liste des permis »
SLUGS = [
    "liste-des-permis-de-construire-et-autres-autorisations-durbanisme",
]
RECHERCHES = [
    "liste des permis de construire et autres autorisations d'urbanisme",
    "sitadel liste permis",
]
UA = {"User-Agent": "prospection-permis/0.1 (test GitHub Actions)"}
DOSSIER = "telechargements"

# Le rapport est écrit à la fois dans le journal et dans le résumé du run
RESUME = os.environ.get("GITHUB_STEP_SUMMARY")
lignes_rapport = []


def dire(texte=""):
    """Affiche une ligne dans le journal et la garde pour le résumé du run."""
    print(texte, flush=True)
    lignes_rapport.append(texte)


def ecrire_resume():
    if RESUME:
        with open(RESUME, "a", encoding="utf-8") as f:
            f.write("\n".join(lignes_rapport) + "\n")


def get_json(url):
    """Lit une URL JSON, avec 4 tentatives."""
    for essai in range(4):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except Exception as e:  # noqa: BLE001 - on veut juste réessayer
            print(f"  (essai {essai + 1}) erreur sur {url} : {e}", flush=True)
            time.sleep(2 ** essai)
    return None


def telecharger(url, chemin):
    """Télécharge un fichier sur le disque (gros fichiers possibles), avec tentatives."""
    for essai in range(4):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=300) as r, open(chemin, "wb") as f:
                while True:
                    bloc = r.read(1 << 20)
                    if not bloc:
                        break
                    f.write(bloc)
            return os.path.getsize(chemin)
        except Exception as e:  # noqa: BLE001
            print(f"  (essai {essai + 1}) téléchargement échoué : {e}", flush=True)
            time.sleep(2 ** essai)
    return None


def trouver_jeux():
    """Retourne la liste des jeux de données candidats (par slug, puis par recherche)."""
    jeux = {}
    for slug in SLUGS:
        d = get_json(f"{API}/datasets/{slug}/")
        if d and d.get("id"):
            jeux[d["id"]] = d
    dire("### Résultats de recherche sur data.gouv.fr")
    for q in RECHERCHES:
        d = get_json(f"{API}/datasets/?q={urllib.parse.quote(q)}&page_size=8")
        for x in (d or {}).get("data", []):
            orga = (x.get("organization") or {}).get("name", "?")
            dire(f"- {x['title']} — *{orga}* — {x.get('page')}")
            titre = x["title"].lower()
            if "liste" in titre and "permis" in titre:
                jeux.setdefault(x["id"], x)
    dire()
    return list(jeux.values())


def ouvrir_csv(chemin):
    """Ouvre un CSV (ou le premier CSV d'un zip) et devine encodage + séparateur."""
    if zipfile.is_zipfile(chemin):
        z = zipfile.ZipFile(chemin)
        noms = [n for n in z.namelist() if n.lower().endswith((".csv", ".txt"))]
        if not noms:
            return None, None
        brut = z.open(noms[0])
        debut = z.open(noms[0]).read(1 << 20)
    else:
        brut = open(chemin, "rb")
        with open(chemin, "rb") as f:
            debut = f.read(1 << 20)
    try:
        debut.decode("utf-8")
        encodage = "utf-8-sig"
    except UnicodeDecodeError:
        encodage = "cp1252"
    texte = io.TextIOWrapper(brut, encoding=encodage, errors="replace", newline="")
    premiere = debut.decode(encodage, errors="replace").splitlines()[0]
    sep = max([";", ",", "\t", "|"], key=premiere.count)
    return csv.reader(texte, delimiter=sep), encodage


def colonne(entetes, *motifs, exact=None):
    """Trouve l'index d'une colonne : nom exact d'abord, sinon contenant tous les motifs."""
    haut = [h.upper().strip() for h in entetes]
    for e in exact or []:
        if e in haut:
            return haut.index(e)
    for i, h in enumerate(haut):
        if all(m in h for m in motifs):
            return i
    return None


def premier(*valeurs):
    """Premier index trouvé (attention : l'index 0 est valide, on ne peut pas utiliser « or »)."""
    return next((v for v in valeurs if v is not None), None)


def mois(valeur):
    """'2025-03-14' ou '14/03/2025' → '2025-03' (sinon '?')."""
    v = (valeur or "").strip()
    if len(v) >= 7 and v[4] == "-":
        return v[:7]
    if len(v) >= 10 and v[2] == "/" and v[5] == "/":
        return f"{v[6:10]}-{v[3:5]}"
    return "?"


def analyser(chemin, titre):
    """Lit un fichier ligne à ligne et produit les statistiques sur les départements visés."""
    lecteur, encodage = ouvrir_csv(chemin)
    if lecteur is None:
        dire("Pas de CSV dans ce fichier.\n")
        return []
    entetes = next(lecteur)
    i_dep = colonne(entetes, exact=["DEP", "DEP_CODE", "DEPARTEMENT", "CODE_DEPARTEMENT"])
    i_comm = colonne(entetes, exact=["COMM", "CODE_COMMUNE", "COM", "INSEE_COM"])
    i_type = premier(colonne(entetes, "TYPE_DAU"), colonne(entetes, "TYPE"))
    i_date = premier(colonne(entetes, "DATE_REELLE_AUTORISATION"), colonne(entetes, "DATE", "AUTOR"))
    i_cat = colonne(entetes, "CAT_DEM")
    i_denom = colonne(entetes, "DENOM_DEM")
    i_adr = [i for i, h in enumerate(entetes) if h.upper().startswith("ADR_") and h.upper().endswith("_TER")]
    i_libvoie = colonne(entetes, "ADR_LIBVOIE_TER")

    def nom(i):
        return entetes[i] if i is not None else "—"

    dire(f"- Encodage : {encodage} — {len(entetes)} colonnes")
    dire(f"- Colonnes repérées : département={nom(i_dep)}, commune={nom(i_comm)}, type={nom(i_type)}, "
         f"date={nom(i_date)}, catégorie demandeur={nom(i_cat)}, nom demandeur={nom(i_denom)}, "
         f"adresse terrain={[entetes[i] for i in i_adr]}")

    total = gardes = 0
    par_dep = collections.Counter()
    par_type = collections.Counter()
    par_mois = collections.Counter()
    par_cat = collections.Counter()
    sans_nom = avec_adresse_sans_nom = 0
    exemple_valeur = {}
    exemples_particuliers = []

    for ligne in lecteur:
        total += 1
        if len(ligne) < len(entetes):
            ligne += [""] * (len(entetes) - len(ligne))
        if i_dep is not None:
            dep = ligne[i_dep].strip().zfill(2)
        elif i_comm is not None:
            dep = ligne[i_comm].strip()[:2]
        else:
            dep = "?"
        if dep not in DEPS:
            continue
        gardes += 1
        par_dep[dep] += 1
        if i_type is not None:
            par_type[ligne[i_type].strip()] += 1
        if i_date is not None:
            par_mois[mois(ligne[i_date])] += 1
        if i_cat is not None:
            par_cat[ligne[i_cat].strip()] += 1
        for i, h in enumerate(entetes):
            if h not in exemple_valeur and ligne[i].strip():
                exemple_valeur[h] = ligne[i].strip()
        nom_vide = i_denom is None or not ligne[i_denom].strip()
        if nom_vide:
            sans_nom += 1
            if i_libvoie is not None and ligne[i_libvoie].strip():
                avec_adresse_sans_nom += 1
                if len(exemples_particuliers) < 5 and mois(ligne[i_date] if i_date is not None else "") >= "2025-01":
                    exemples_particuliers.append({h: ligne[i] for i, h in enumerate(entetes) if ligne[i].strip()})

    dire(f"- Lignes au total (France) : **{total:,}** — dans 54/55/57/88 : **{gardes:,}**".replace(",", " "))
    dire(f"- Par département : {dict(sorted(par_dep.items()))}")
    dire(f"- Par type de dossier : {dict(par_type.most_common())}")
    dire(f"- Par catégorie de demandeur : {dict(par_cat.most_common(15))}")
    if gardes:
        dire(f"- Sans nom de demandeur (≈ particuliers) : {sans_nom:,} — dont avec adresse du terrain : "
             f"{avec_adresse_sans_nom:,}".replace(",", " "))
    derniers = sorted(m for m in par_mois if m != "?")[-15:]
    dire(f"- Mois les plus récents : {', '.join(f'{m} ({par_mois[m]})' for m in derniers)}")
    dire("")
    dire("<details><summary>Toutes les colonnes, avec un exemple de valeur</summary>\n")
    dire("| Colonne | Exemple |")
    dire("|---|---|")
    for h in entetes:
        dire(f"| `{h}` | {exemple_valeur.get(h, '')[:60]} |")
    dire("\n</details>\n")
    if exemples_particuliers:
        dire("<details><summary>Exemples de dossiers sans nom de demandeur (2025+)</summary>\n")
        for ex in exemples_particuliers:
            dire("```")
            dire(json.dumps(ex, ensure_ascii=False, indent=1))
            dire("```")
        dire("\n</details>\n")
    return exemples_particuliers


def adresse_texte(ex):
    """Recompose une adresse lisible à partir des colonnes ADR_*_TER."""
    morceaux = [ex.get(k, "") for k in ("ADR_NUM_TER", "ADR_TYPEVOIE_TER", "ADR_LIBVOIE_TER",
                                          "ADR_LIEUDIT_TER", "ADR_CODPOST_TER", "ADR_LOCALITE_TER")]
    return " ".join(m for m in morceaux if m).strip()


def tester_geocodage(exemples):
    """Essaie de placer quelques adresses sur la carte (2 services gratuits de l'État)."""
    dire("## Test du géocodage (adresse → point sur la carte)")
    services = {
        "Géoplateforme IGN": "https://data.geopf.fr/geocodage/search?limit=1&q=",
        "api-adresse (ancien)": "https://api-adresse.data.gouv.fr/search/?limit=1&q=",
    }
    for ex in exemples[:3]:
        adr = adresse_texte(ex)
        if not adr:
            continue
        for nom_service, base in services.items():
            d = get_json(base + urllib.parse.quote(adr))
            feats = (d or {}).get("features") or []
            if feats:
                p = feats[0]["properties"]
                dire(f"- {nom_service} : « {adr} » → {p.get('label')} (score {p.get('score', 0):.2f})")
            else:
                dire(f"- {nom_service} : « {adr} » → rien trouvé / service injoignable")
    dire()


def main():
    os.makedirs(DOSSIER, exist_ok=True)
    dire("# Étape 0 — Test des données Sitadel (54, 55, 57, 88)\n")
    jeux = trouver_jeux()
    if not jeux:
        dire("**Aucun jeu de données trouvé.** Voir les résultats de recherche ci-dessus.")
        ecrire_resume()
        sys.exit(1)

    tous_exemples = []
    for jeu in jeux:
        dire(f"## Jeu de données : {jeu['title']}")
        dire(f"{jeu.get('page')} — mis à jour le {str(jeu.get('last_modified', ''))[:10]}\n")
        for res in jeu.get("resources", []):
            fmt = (res.get("format") or "").lower()
            url = res.get("url") or ""
            taille = res.get("filesize") or 0
            dire(f"### Fichier : {res.get('title')}")
            dire(f"- Format : {fmt or '?'} — taille : {taille / 1e6:.0f} Mo — "
                 f"modifié le {str(res.get('last_modified', ''))[:10]}")
            dire(f"- Lien : {url}")
            if fmt not in ("csv", "zip", "txt", "") or "doc" in (res.get("title") or "").lower():
                dire("- (ignoré : pas un fichier de données CSV)\n")
                continue
            chemin = os.path.join(DOSSIER, res["id"])
            octets = telecharger(url, chemin)
            if not octets:
                dire("- **Téléchargement impossible.**\n")
                continue
            dire(f"- Téléchargé : {octets / 1e6:.0f} Mo")
            try:
                tous_exemples += analyser(chemin, res.get("title"))
            except Exception as e:  # noqa: BLE001 - on continue avec les autres fichiers
                dire(f"- **Erreur de lecture** : {e}\n")
            os.remove(chemin)

    tester_geocodage(tous_exemples)
    ecrire_resume()


if __name__ == "__main__":
    main()
