# Règles du projet prospection-permis

Outil de prospection pour apporteur d'affaires : récupère les autorisations d'urbanisme
(permis de construire, déclarations préalables, permis de démolir, permis d'aménager)
publiées en open data (Sitadel, data.gouv.fr), les affiche dans une appli web (iPhone)
avec carte, suivi des prospects, nouveautés, courriers à imprimer et export Excel/CSV.

- Travailler directement sur `main` (pas de nouvelle branche sauf demande explicite).
- Code commenté en français, simple à lire.
- L'utilisateur n'a pas de PC : tout se lance via GitHub Actions (workflows manuels depuis l'iPhone).
- Le conteneur de développement Claude ne peut PAS joindre data.gouv.fr : tout test de données
  passe par un workflow GitHub Actions.
- Ne jamais journaliser de secret (token Cloudflare, mot de passe de l'appli).
- Réponses à l'utilisateur : courtes et simples (listes), avec TOUJOURS les liens directs réels.

## Choix validés avec l'utilisateur (2026-11-07)

- Prospects : **particuliers**. Garder **tous** les types de dossiers (tri par filtres dans l'appli).
- Zone : départements **54, 55, 57, 88**. Période : **12 derniers mois**, mise à jour mensuelle.
- Fonctions de l'appli : liste + filtres, **carte** (+ itinéraire), **suivi des prospects**
  (statut + notes), **nouveautés** depuis la dernière visite, **courriers à imprimer**
  (« Au propriétaire », mention RGPD : source + droit d'opposition), **export Excel/CSV**.
- Hébergement : **Cloudflare** (compte volkan.fener.54, comme tiktok-resume), protégé par
  mot de passe, statuts/notes stockés en ligne (KV). Dépôt GitHub privé.
- RGPD : Sitadel ne publie le nom du demandeur que pour les personnes morales ; pour les
  particuliers on n'a que l'adresse du terrain.

## État en cours

- Plan : étape 0 = test des données (`test_donnees.py` + `test-donnees.yml`) ; étape 1 = robot
  mensuel (filtre 4 départements, 12 mois, géocodage) ; étape 2 = appli Cloudflare ;
  étape 3 = courriers.
- **Étape 0 écrite (2026-11-07)**, à lancer puis analyser le rapport.
- En attente côté utilisateur : token Cloudflare (modèle « Edit Cloudflare Workers » +
  « Workers KV Storage : Edit ») à enregistrer en secret du dépôt, + mot de passe de l'appli.
