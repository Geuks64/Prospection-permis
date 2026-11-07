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
- **Étape 0 VALIDÉE (2026-11-07, run #1 `test-donnees.yml`)** — jeu data.gouv
  `liste-des-permis-de-construire-et-autres-autorisations-durbanisme` (SDES), 4 CSV France entière
  (séparateur `;`, UTF-8 BOM), téléchargeables sur l'API DiDo :
  `https://data.statistiques.developpement-durable.gouv.fr/dido/api/v1/datafiles/<rid>/csv`
  - logements `8b35affb-55fc-4c1f-915b-7750f974446a` (994 Mo, 142 col., PC/DP/PA) ;
  - locaux non résidentiels `f8f0700f-806c-40a7-83b1-f21cf507e7c4` (378 Mo, 141 col., PC/DP/PA) ;
  - permis de démolir `1a9a2f0c-56fe-4e69-84a7-fbbda2121f02` (60 Mo, 81 col., pas de TYPE_DAU, `ETAT_PD`) ;
  - permis d'aménager `96883f50-538b-41f9-a059-c6eb97e6a23a` (35 Mo, 84 col.).
  - Colonnes clés : `DEP_CODE`, `COMM` (INSEE), `TYPE_DAU`, `NUM_DAU`, `ETAT_DAU`,
    `DATE_REELLE_AUTORISATION`, `DATE_REELLE_DOC` (ouverture chantier), `DATE_REELLE_DAACT`
    (achèvement), `DENOM_DEM`/`SIRET_DEM` (vides pour les particuliers), `CODPOST_DEM`/`LOCALITE_DEM`
    (domicile du demandeur, rempli aussi pour les particuliers), `ADR_NUM_TER`, `ADR_LIBVOIE_TER`,
    `ADR_LIEUDIT_TER`, `ADR_CODPOST_TER`, `ADR_LOCALITE_TER`, `SEC_CADASTREn`/`NUM_CADASTREn`,
    `SUPERFICIE_TERRAIN`, `NATURE_PROJET_*`, `DESTINATION_PRINCIPALE`, `I_EXTENSION`, `I_PISCINE`,
    `I_GARAGE`, `I_VERANDA`, `NB_LGT_*`, `SURF_HAB_CREEE`… Pas de colonne `CAT_DEM`.
  - Volume 54/55/57/88 : ~230 dossiers logements/mois, ~170 locaux/mois, ~70 démolitions/mois,
    ~15 PA/mois → **~6 000 dossiers sur 12 mois**. ~88 % des dossiers logements sans nom (particuliers),
    adresse du terrain présente dans ~85 % des cas. Données jusqu'à **fin septembre 2026**
    (publication du 31/10) : ~1 mois de retard ; les derniers mois se complètent ensuite.
  - Géocodage OK sur `https://data.geopf.fr/geocodage/search` (et l'ancien api-adresse) — garder le
    score, adresses partielles → point sur la rue/commune.
  - Les DP sans création de surface (piscine seule, clôture, ravalement) ne sont PAS dans Sitadel.
- En attente côté utilisateur : token Cloudflare (modèle « Edit Cloudflare Workers » +
  « Workers KV Storage : Edit ») à enregistrer en secret du dépôt, + mot de passe de l'appli.
