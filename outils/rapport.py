#!/usr/bin/env python3
"""
Rapport interne quotidien (workflow « Rapport ») : lit le journal de l'appli (erreurs, lenteurs,
usage), vérifie la fraîcheur des données, puis ouvre un ticket GitHub (« Issue ») avec l'analyse,
à relire par Claude pour corriger / améliorer l'appli. Rien de tout ça n'est visible dans l'appli.

Un ticket est ouvert s'il y a des erreurs ou des alertes, chaque lundi (bilan d'usage de la
semaine), ou quand on lance le workflow à la main. Le journal des erreurs est ensuite vidé.
Variables : APP_URL, APP_PASSWORD (secret, jamais affiché), GITHUB_TOKEN, GITHUB_REPOSITORY, FORCER.
"""
import collections
import datetime as dt
import json
import os
import urllib.request

APP = os.environ.get("APP_URL", "https://hodemolition.pages.dev").rstrip("/")
UA = {"User-Agent": "prospection-permis/1.0 (rapport interne)"}
AUJ = dt.date.today()


def requete(url, corps=None, cookie="", methode=None, entetes=None):
    h = dict(UA, **(entetes or {}))
    if cookie:
        h["Cookie"] = cookie
    data = None
    if corps is not None:
        data = json.dumps(corps).encode()
        h["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=h, method=methode)
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read(), r.headers


def connexion():
    _, entetes = requete(f"{APP}/api/connexion", {"motdepasse": os.environ["APP_PASSWORD"]})
    cookie = entetes.get("Set-Cookie", "").split(";")[0]
    if not cookie:
        raise RuntimeError("Connexion à l'appli impossible")
    return cookie


def jours_depuis(date_iso):
    try:
        return (AUJ - dt.date.fromisoformat(date_iso[:10])).days
    except (TypeError, ValueError):
        return 999


def main():
    cookie = connexion()
    journal_brut, _ = requete(f"{APP}/api/journal", cookie=cookie)
    j = json.loads(journal_brut)
    erreurs = j.get("journal", [])
    compteurs = j.get("compteurs", {})
    donnees = json.loads(requete(f"{APP}/data/permis.json", cookie=cookie)[0])

    lignes = [f"# 🛠️ Rapport interne HO Démolition — {AUJ.strftime('%d/%m/%Y')}", ""]
    alertes = []

    # ----- Erreurs -----
    total = sum(e.get("n", 1) for e in erreurs)
    lignes.append(f"## 🐞 Erreurs et problèmes ({len(erreurs)} différents, {total} au total)")
    if erreurs:
        lignes += ["", "| Type | Message | Fois | Dernière fois | Appareil |", "|---|---|---|---|---|"]
        for e in sorted(erreurs, key=lambda x: -x.get("n", 1)):
            app = (e.get("appareil") or "").split(" · ")
            court = " · ".join(x for x in app[1:] if x) or app[0][:60]
            msg = e["msg"].replace("|", "/")
            lignes.append(f"| {e['type']} | {msg} | {e.get('n', 1)} | {e.get('dernier', '')[:16].replace('T', ' ')} | {court} |")
        details = [e for e in erreurs if e.get("detail")]
        if details:
            lignes += ["", "<details><summary>Détails techniques (piles d'appels, appareils)</summary>", ""]
            for e in details[:30]:
                lignes += [f"**{e['type']} — {e['msg']}** ({e.get('appareil', '')})", "```", e["detail"][:1500], "```"]
            lignes += ["</details>"]
    else:
        lignes.append("\nAucune erreur enregistrée 👍")

    # ----- Usage sur 7 jours -----
    semaine = [(AUJ - dt.timedelta(days=i)).isoformat() for i in range(7)]
    usage = collections.Counter()
    for jour in semaine:
        usage.update(compteurs.get(jour, {}))
    lignes += ["", "## 📊 Utilisation sur 7 jours"]
    if usage:
        lignes += ["", "| Action | Nombre |", "|---|---|"]
        lignes += [f"| {k} | {v} |" for k, v in usage.most_common()]
        jours_actifs = sum(1 for jour in semaine if compteurs.get(jour))
        lignes.append(f"\nJours d'utilisation : {jours_actifs}/7")
    else:
        lignes.append("\nAucune utilisation de l'appli cette semaine.")

    # ----- Données -----
    permis = donnees.get("permis", [])
    par_src = collections.Counter({"L": "permis", "N": "permis", "D": "permis", "A": "permis", "V": "ventes", "E": "DPE"}.get(f["src"][0], "?") for f in permis)
    lignes += ["", "## 🗂️ Données",
               f"- Mise à jour par le robot : {donnees.get('maj')} (il y a {jours_depuis(donnees.get('maj'))} j)",
               f"- Permis jusqu'au {donnees.get('derniere_autorisation')} · ventes jusqu'au {donnees.get('derniere_vente')} · DPE jusqu'au {donnees.get('dernier_dpe')}",
               f"- Dossiers : {dict(par_src)} · placés sur la carte : {sum(1 for f in permis if f.get('lat') is not None)}/{len(permis)}",
               f"- Adresses regroupées : {len({f['grp'] for f in permis if f.get('grp')})}"]
    if jours_depuis(donnees.get("maj")) > 8:
        alertes.append(f"Le robot n'a pas mis les données à jour depuis {jours_depuis(donnees.get('maj'))} jours.")
    if jours_depuis(donnees.get("derniere_autorisation")) > 75:
        alertes.append("Les permis (Sitadel) semblent ne plus être mis à jour par l'État (> 75 jours).")
    if jours_depuis(donnees.get("dernier_dpe")) > 21:
        alertes.append("Les DPE (ADEME) ont plus de 3 semaines : vérifier l'API DPE.")
    if par_src.get("ventes", 0) == 0:
        alertes.append("Aucune vente DVF dans les données.")
    if par_src.get("DPE", 0) == 0:
        alertes.append("Aucun DPE dans les données.")

    # ----- Pistes automatiques -----
    pistes = []
    types = collections.Counter(e["type"] for e in erreurs)
    if types.get("carte") or any("leaflet" in e["msg"].lower() for e in erreurs):
        pistes.append("La carte ne se charge pas chez l'utilisateur : héberger Leaflet dans `public/` au lieu de cdnjs.")
    if types.get("lenteur"):
        pistes.append("Démarrages lents : alléger `permis.json` (découpage par source, champs plus courts) ou différer la carte.")
    if types.get("serveur"):
        pistes.append("Erreurs du serveur : voir les journaux Cloudflare Pages (projet hodemolition).")
    if types.get("erreur-js") or types.get("promesse"):
        pistes.append("Bugs JavaScript : corriger d'après les piles d'appels ci-dessus.")
    if usage and not usage.get("courriers-prepares"):
        pistes.append("Les courriers ne sont pas utilisés : demander à HO si le format convient.")
    if usage and not usage.get("onglet:carte"):
        pistes.append("La carte n'est jamais ouverte : vérifier qu'elle s'affiche sur iPhone.")
    if usage.get("envoi-hors-ligne"):
        pistes.append(f"{usage['envoi-hors-ligne']} modifications faites hors-ligne : le mode hors-ligne sert, à garder.")

    if alertes:
        lignes += ["", "## ⚠️ Alertes", *[f"- {a}" for a in alertes]]
    if pistes:
        lignes += ["", "## 💡 Pistes d'amélioration (automatiques)", *[f"- {p}" for p in pistes]]
    lignes += ["", "---", "_Rapport généré automatiquement (workflow « Rapport »). "
               "Pour corriger : ouvrir une session Claude et demander « analyse les rapports »._"]
    texte = "\n".join(lignes)
    print(texte)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as f:
            f.write(texte + "\n")

    # ----- Ticket GitHub -----
    lundi = AUJ.weekday() == 0
    if not (erreurs or alertes or lundi or os.environ.get("FORCER")):
        print("\nRien à signaler aujourd'hui : pas de ticket.")
        return
    titre = f"🛠️ Rapport HO {AUJ.strftime('%d/%m/%Y')} — {total} erreur(s), {len(alertes)} alerte(s)"
    requete(f"https://api.github.com/repos/{os.environ['GITHUB_REPOSITORY']}/issues",
            {"title": titre, "body": texte[:60000], "labels": ["rapport-auto"]},
            entetes={"Authorization": f"Bearer {os.environ['GITHUB_TOKEN']}", "Accept": "application/vnd.github+json"})
    print(f"\nTicket ouvert : {titre}")
    if erreurs:
        requete(f"{APP}/api/journal/vider", {}, cookie=cookie)
        print("Journal des erreurs vidé.")


if __name__ == "__main__":
    main()
