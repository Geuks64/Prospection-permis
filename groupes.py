#!/usr/bin/env python3
"""
Regroupe les dossiers qui concernent la même maison / le même bien (utilisé par robot.py).

Une même adresse peut avoir un permis, une vente et un DPE : l'appli les affiche alors comme
UN seul prospect qui cumule tous ses signaux. Liens utilisés :
  - même adresse normalisée (commune + numéro + nom de voie) ;
  - même parcelle cadastrale (lien vente → permis, champs `achat` / `pc`) ;
  - même position à ~25 m près (lien DPE → permis / vente, champ `lies`).
Chaque dossier d'un groupe reçoit `grp` = identifiant stable du groupe (sert aussi de clé pour
le suivi des prospects dans l'appli).
"""
import re
import unicodedata

# Abréviations courantes, pour que « AVENUE DE LA GARE » = « AV DE LA GARE »
ABREV = {
    "AVENUE": "AV", "BOULEVARD": "BD", "PLACE": "PL", "CHEMIN": "CHE", "ROUTE": "RTE",
    "IMPASSE": "IMP", "ALLEE": "ALL", "ALLEES": "ALL", "FAUBOURG": "FG", "QUAI": "QU",
    "SQUARE": "SQ", "RESIDENCE": "RES", "LOTISSEMENT": "LOT", "SENTIER": "SEN", "COURS": "CRS",
    "MONTEE": "MTE", "PASSAGE": "PAS", "RUELLE": "RLE", "HAMEAU": "HAM", "CITE": "CITE",
    "SAINT": "ST", "SAINTE": "STE", "GENERAL": "GAL", "MARECHAL": "MAL", "DOCTEUR": "DR",
}
MAX_GROUPE = 6
MOTS_VIDES = {"DE", "DU", "DES", "LA", "LE", "LES", "L", "D", "ET", "A", "AU", "AUX"}


def normaliser_adresse(adr):
    """« 12 bis, Rue de l'Abbaye » → ('12', 'RUE ABBAYE')  (numéro, voie) ou None."""
    s = unicodedata.normalize("NFD", adr or "").encode("ascii", "ignore").decode().upper()
    s = re.sub(r"[^A-Z0-9 ]", " ", s)
    mots = s.split()
    if not mots or not mots[0][:1].isdigit():
        return None
    numero = re.match(r"\d+", mots[0]).group()
    reste = [ABREV.get(m, m) for m in mots[1:] if m not in MOTS_VIDES
             and m not in ("BIS", "TER", "B", "T", "Q")]
    if not reste or numero == "0":
        return None
    return numero, " ".join(reste)


class Union:
    """Petit « union-find » : regroupe des éléments reliés entre eux."""

    def __init__(self):
        self.parent = {}

    def trouver(self, x):
        self.parent.setdefault(x, x)
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def unir(self, a, b):
        ra, rb = self.trouver(a), self.trouver(b)
        if ra != rb:
            self.parent[max(ra, rb)] = min(ra, rb)


def regrouper(fiches):
    u = Union()
    ids = {f["id"] for f in fiches}
    par_adresse = {}
    cle_adresse = {}
    for f in fiches:
        u.trouver(f["id"])
        norm = normaliser_adresse(f.get("adr", ""))
        if norm and f.get("insee"):
            cle = f"{f['insee']}|{norm[0]}|{norm[1]}"
            cle_adresse[f["id"]] = cle
            if cle in par_adresse:
                u.unir(par_adresse[cle], f["id"])
            else:
                par_adresse[cle] = f["id"]
        # liens déjà calculés (parcelle, proximité)
        for autre in ([f["achat"]["id"]] if f.get("achat") else []) + f.get("pc", []) + f.get("lies", []):
            if autre in ids:
                u.unir(f["id"], autre)

    groupes = {}
    for f in fiches:
        groupes.setdefault(u.trouver(f["id"]), []).append(f)
    nb = 0
    for membres in groupes.values():
        # Plus de 6 dossiers à la même adresse = immeuble ou zone d'activité, pas une maison : on ne regroupe pas
        if len(membres) < 2 or len(membres) > MAX_GROUPE:
            continue
        nb += 1
        # Identifiant stable : l'adresse normalisée la plus fréquente du groupe, sinon le plus petit id
        cles = sorted(cle_adresse[m["id"]] for m in membres if m["id"] in cle_adresse)
        grp = "G" + (max(set(cles), key=cles.count) if cles else min(m["id"] for m in membres))
        for m in membres:
            m["grp"] = grp
    print(f"  {nb} adresses regroupent plusieurs dossiers "
          f"({sum(len(m) for m in groupes.values() if 1 < len(m) <= MAX_GROUPE)} dossiers)", flush=True)
