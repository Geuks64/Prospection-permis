// =============================================================================
// ho.js — Tout ce qui est propre à HO Démolition : coordonnées, note « intérêt HO »
// de chaque dossier, services à proposer, phrase d'accroche et texte des courriers.
// Pour adapter l'appli à une autre entreprise, c'est ce fichier qu'il faut modifier.
// =============================================================================
"use strict";

const HO = {
  nom: "HO Démolition",
  slogan: "Un seul interlocuteur, plusieurs solutions !",
  telephone: "06 49 85 96 54",
  email: "hodemolition@gmail.com",
  ville: "Toul (54200)",
  base: { lat: 48.6753, lon: 5.8917, nom: "Toul" }, // point de départ pour les distances
};

// Services de HO (métier principal) et corps de métier de la mise en relation
const SERVICES = {
  debarras: "Débarras",
  curage: "Curage",
  nettoyage: "Nettoyage",
  nettoyage_fin: "Nettoyage fin de chantier",
  evacuation: "Évacuation des gravats",
  ouvertures: "Ouverture de murs / cloisons",
  maconnerie: "Maçonnerie",
  dalle: "Dalle",
  terrassement: "Terrassement",
  terrasse: "Terrasse / pavés",
  murets: "Murets / clôture",
  facade: "Façade",
  toiture: "Toiture / charpente",
  gouttieres: "Gouttières alu",
  etancheite: "Étanchéité",
  plomberie: "Plomberie",
  electricite: "Électricité",
};

// Distance « à vol d'oiseau » en km entre deux points
function distanceKm(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}
function distanceToul(f) {
  return f.lat == null ? null : distanceKm(HO.base.lat, HO.base.lon, f.lat, f.lon);
}

// Catégorie du projet, vue par HO (sert à la note, aux services et au courrier)
function categorieHO(f) {
  if (f.t === "PD") return "demolition";
  if (f.t === "PA") return "amenagement";
  const transformation = [2, 3, 4].includes(f.nat) || f.tt > 0;
  if (!f.src.includes("L")) return f.nat === 1 ? "local_neuf" : "local_travaux";
  if (transformation) return "transformation";
  if (f.nat === 5 || f.nat === 6) return "extension";
  if (f.nat === 1 && f.tl === 1) return "maison_neuve";
  if (f.nat === 1) return "logements_neufs";
  return "transformation";
}

const SERVICES_PAR_CATEGORIE = {
  demolition: ["debarras", "curage", "evacuation", "nettoyage", "terrassement", "maconnerie"],
  transformation: ["debarras", "curage", "nettoyage", "ouvertures", "maconnerie", "plomberie", "electricite", "facade"],
  extension: ["debarras", "ouvertures", "maconnerie", "dalle", "terrassement", "toiture", "gouttieres"],
  maison_neuve: ["terrassement", "dalle", "terrasse", "murets", "gouttieres", "plomberie", "electricite", "nettoyage_fin"],
  logements_neufs: ["nettoyage_fin", "evacuation", "terrassement", "terrasse", "murets"],
  local_travaux: ["debarras", "curage", "nettoyage", "evacuation", "ouvertures", "plomberie", "electricite"],
  local_neuf: ["terrassement", "dalle", "nettoyage_fin", "evacuation"],
  amenagement: ["terrassement", "murets", "terrasse", "evacuation"],
};

// Société qui achète / rénove pour revendre ou louer : client potentiel régulier
function estInvestisseur(f) {
  if (!f.dem) return false;
  const nom = `${f.dem} ${f.ent?.nom || ""}`.toUpperCase();
  return /\bSCI\b|IMMO|PATRIMOINE|INVEST|FONCI|HABITAT|LOGEMENT|PROMO|MARCHAND/.test(nom) ||
    /^68\./.test(f.ape || "") || /^41\.10/.test(f.ape || "") || f.cj === "6540";
}

/**
 * Note « intérêt HO » d'un dossier.
 * Renvoie { points, niveau (3 très chaud, 2 chaud, 1 tiède, 0 froid), raisons[], services[] }.
 */
function noteHO(f) {
  if (f._note) return f._note; // calculée une seule fois par dossier
  const cat = categorieHO(f);
  const raisons = [];
  let p = 0;

  const base = {
    demolition: [60, "Permis de démolir : débarras, curage et évacuation à prévoir avant"],
    transformation: [50, "Transformation d'un bâtiment existant : il faut vider et curer avant les travaux"],
    local_travaux: [45, "Travaux dans un local existant : curage de local à proposer"],
    extension: [35, "Extension / agrandissement : préparation des lieux, ouvertures, maçonnerie"],
    maison_neuve: [22, "Maison neuve : artisans à placer (terrassement, dalle, terrasse, gouttières…)"],
    logements_neufs: [18, "Programme de logements neufs : nettoyage de fin de chantier à proposer"],
    local_neuf: [10, "Bâtiment d'activité neuf : terrassement, nettoyage de fin de chantier"],
    amenagement: [10, "Lotissement / aménagement : terrassement, murets"],
  }[cat];
  p += base[0];
  raisons.push(base[1]);

  if (f.tt === 1) { p += 15; raisons.push("Changement de destination (grange, garage, local → logement) : souvent beaucoup à débarrasser"); }
  if (f.sdem > 0) { p += 20; raisons.push(`${f.sdem} m² démolis dans le projet`); }
  if (f.ldem > 0 && f.t !== "PD") { p += 10; raisons.push(`${f.ldem} logement(s) démoli(s)`); }
  if ((f.opt || []).includes("surelevation") || (f.opt || []).includes("niveau")) { p += 10; raisons.push("Surélévation / niveau en plus"); }

  const ch = typeof chantier === "function" ? chantier(f) : "avant";
  if (ch === "avant") { p += 25; raisons.push("Chantier pas encore commencé : c'est le bon moment"); }
  else if (ch === "encours") { p += 3; raisons.push("Chantier déjà commencé : proposer la suite (artisans, nettoyage)"); }
  else { p -= 60; raisons.push("Travaux terminés"); }

  const age = (Date.now() - new Date(f.da || "2000-01-01").getTime()) / 864e5;
  if (age < 90) { p += 15; raisons.push("Autorisé il y a moins de 3 mois"); }
  else if (age < 180) p += 5;

  if (!f.dem && f.dville && f.ville && f.dville.toUpperCase() !== f.ville.toUpperCase() && cat !== "maison_neuve") {
    p += 15; raisons.push(`Le demandeur habite ailleurs (${f.dville}) : sans doute un achat récent`);
  }
  if (estInvestisseur(f)) { p += 10; raisons.push("Investisseur / marchand de biens : peut devenir un client régulier"); }

  const d = distanceToul(f);
  if (d != null) {
    if (d < 20) p += 10;
    else if (d < 40) p += 5;
    else if (d > 80) { p -= 10; raisons.push(`Loin de Toul (${Math.round(d)} km)`); }
  }

  const niveau = p >= 85 ? 3 : p >= 55 ? 2 : p >= 30 ? 1 : 0;
  f._note = { points: p, niveau, raisons, services: SERVICES_PAR_CATEGORIE[cat], categorie: cat };
  return f._note;
}

const NIVEAUX = {
  3: { nom: "Très chaud", icone: "🔥🔥🔥", classe: "n3" },
  2: { nom: "Chaud", icone: "🔥🔥", classe: "n2" },
  1: { nom: "Tiède", icone: "🔥", classe: "n1" },
  0: { nom: "Froid", icone: "❄️", classe: "n0" },
};

// Phrase d'accroche (téléphone / porte-à-porte) selon le projet
function accroche(f) {
  const lieu = joli(f.ville);
  return {
    demolition: `Bonjour, je vous appelle de la part de HO Démolition, à Toul. J'ai vu que vous aviez un permis de démolir à ${lieu} : avant la démolition, on peut s'occuper du débarras, du curage et de l'évacuation, et vous mettre en relation avec des artisans pour la suite. Le devis est gratuit.`,
    transformation: `Bonjour, HO Démolition à Toul. Vous préparez des travaux de transformation à ${lieu} : avant le chantier, on vide et on remet les lieux à nu (débarras, curage, nettoyage), puis on vous met en relation avec des artisans de confiance. Un seul interlocuteur pour tout, devis gratuit.`,
    extension: `Bonjour, HO Démolition à Toul. Vous agrandissez votre maison à ${lieu} : on peut libérer la place (débarras du garage, de la cave…) et vous trouver les bons artisans pour l'ouverture des murs, la maçonnerie et la dalle. Devis gratuit.`,
    maison_neuve: `Bonjour, HO Démolition à Toul. Félicitations pour votre construction à ${lieu} ! On vous met en relation gratuitement avec des artisans locaux pour le terrassement, la terrasse, les murets, les gouttières alu… et on peut faire le nettoyage de fin de chantier avant votre emménagement.`,
    logements_neufs: `Bonjour, HO Démolition à Toul. Pour votre programme à ${lieu}, nous proposons le nettoyage de fin de chantier et l'évacuation des déchets avant livraison, ainsi que des artisans locaux pour les extérieurs.`,
    local_travaux: `Bonjour, HO Démolition à Toul. Pour les travaux de votre local à ${lieu}, nous réalisons le débarras, le curage et le nettoyage pour remettre les lieux à nu avant travaux, et nous pouvons vous mettre en relation avec des artisans.`,
    local_neuf: `Bonjour, HO Démolition à Toul. Pour votre nouveau bâtiment à ${lieu}, nous proposons le nettoyage de fin de chantier et la mise en relation avec des artisans locaux (terrassement, dalle…).`,
    amenagement: `Bonjour, HO Démolition à Toul. Pour l'aménagement de votre terrain à ${lieu}, nous vous mettons en relation avec des artisans locaux : terrassement, murets, pavés, évacuation.`,
  }[noteHO(f).categorie];
}

// ----- Courriers -------------------------------------------------------------

// Corps de la lettre (paragraphes) selon le projet
function paragraphesCourrier(f) {
  const ou = [joli(f.adr), joli(f.ld)].filter(Boolean).join(", ") || "votre terrain";
  const lieu = `${ou} à ${joli(f.ville)}`;
  const suite = "Pour la suite, nous vous mettons en relation avec des artisans locaux, qualifiés et de confiance (maçonnerie, ouverture de murs, plomberie, électricité, façade, toiture…). Ce service est gratuit pour vous.";
  return {
    demolition: [
      `Vous avez obtenu un permis de démolir pour le bien situé ${lieu}.`,
      "Avant la démolition, HO Démolition peut prendre en charge le débarras complet, le curage et l'évacuation des encombrants et des gravats, rapidement et proprement.",
      "Ensuite, nous vous mettons en relation avec des artisans de confiance pour la reconstruction : terrassement, maçonnerie, dalle, plomberie, électricité…",
    ],
    transformation: [
      `Vous préparez des travaux de transformation pour le bien situé ${lieu}.`,
      "Avant tout chantier, il faut souvent vider et remettre les lieux à nu : c'est notre métier. Débarras de maisons et de locaux, évacuation des meubles et encombrants, curage intérieur et nettoyage.",
      suite,
    ],
    extension: [
      `Vous allez agrandir votre maison située ${lieu}.`,
      "Nous pouvons libérer la place avant les travaux (débarras du garage, de la cave, du grenier…) et évacuer les déchets.",
      "Nous vous mettons aussi en relation, gratuitement, avec des artisans locaux et qualifiés pour l'ouverture des murs, la maçonnerie, la dalle, le terrassement, la toiture ou les gouttières alu.",
    ],
    maison_neuve: [
      `Félicitations pour votre projet de construction ${lieu} !`,
      "Pour les travaux extérieurs et les finitions, nous vous mettons en relation, gratuitement, avec des artisans locaux et qualifiés : terrassement, dalles, terrasses, pavés, murets, gouttières alu, plomberie, électricité…",
      "Et avant votre emménagement, notre équipe peut réaliser le nettoyage complet de fin de chantier.",
    ],
    logements_neufs: [
      `Nous avons appris votre projet de construction de logements ${lieu}.`,
      "HO Démolition réalise le nettoyage de fin de chantier et l'évacuation des déchets avant la livraison, et peut vous mettre en relation avec des artisans locaux pour les aménagements extérieurs.",
    ],
    local_travaux: [
      `Vous préparez des travaux dans le local situé ${lieu}.`,
      "Nous réalisons le débarras, le curage et le nettoyage pour remettre les lieux à nu avant travaux, avec évacuation des déchets.",
      suite,
    ],
    local_neuf: [
      `Nous avons appris votre projet de construction ${lieu}.`,
      "HO Démolition peut réaliser le nettoyage de fin de chantier et l'évacuation des déchets, et vous mettre en relation avec des artisans locaux (terrassement, dalle…).",
    ],
    amenagement: [
      `Nous avons appris votre projet d'aménagement ${lieu}.`,
      "Nous vous mettons en relation avec des artisans locaux pour le terrassement, les murets, les pavés et l'évacuation des déchets.",
    ],
  }[noteHO(f).categorie];
}

// Destinataire du courrier (lignes de l'adresse)
function destinataire(f) {
  if (f.dem) {
    const lignes = [f.ent?.nom || f.dem];
    if (f.ent?.dir) lignes.push(`À l'attention de ${f.ent.dir.replace(/\s*\(.*\)$/, "")}`);
    if (f.ent?.adr) {
      // « 12 RUE DE LA GARE 54200 TOUL » → 2 lignes
      const m = f.ent.adr.match(/^(.*?)\s+(\d{5}\s+.*)$/);
      lignes.push(...(m ? [joli(m[1]), m[2].replace(/^(\d{5})\s+(.*)$/, (x, cp, v) => `${cp} ${v.toUpperCase()}`)] : [joli(f.ent.adr)]));
    } else {
      lignes.push(joli(f.adr) || joli(f.ld), `${f.cp} ${(f.ville || "").toUpperCase()}`);
    }
    return lignes.filter(Boolean);
  }
  return ["Au propriétaire / À l'occupant", joli(f.adr), joli(f.ld), `${f.cp || ""} ${(f.ville || "").toUpperCase()}`.trim()].filter(Boolean);
}

function htmlCourrier(f) {
  const date = new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  const objet = { demolition: "votre projet de démolition", maison_neuve: "votre projet de construction", logements_neufs: "votre programme de construction", local_neuf: "votre projet de construction", amenagement: "votre projet d'aménagement" }[noteHO(f).categorie] || "vos travaux";
  const madame = "Madame, Monsieur,";
  return `<section class="lettre">
    <div class="lettre-tete">
      <div class="lettre-logo">${LOGO_SVG}<div><b>${HO.nom}</b><br><small>${HO.slogan}</small></div></div>
      <div class="lettre-coord">${HO.ville}<br>☎ ${HO.telephone}<br>${HO.email}</div>
    </div>
    <div class="lettre-dest">${destinataire(f).map(echapper).join("<br>")}</div>
    <div class="lettre-date">Toul, le ${date}</div>
    <div class="lettre-objet"><b>Objet :</b> ${objet} — débarras, curage, nettoyage et artisans de confiance</div>
    <div class="lettre-corps" contenteditable="true">
      <p>${madame}</p>
      ${paragraphesCourrier(f).map((x) => `<p>${echapper(x)}</p>`).join("")}
      <p><b>Intervention rapide, travail soigné, conseils personnalisés et devis gratuit.</b> Un seul interlocuteur pour tout votre projet.</p>
      <p>Appelez-nous au <b>${HO.telephone}</b> ou écrivez-nous à <b>${HO.email}</b> : nous serons heureux d'en parler avec vous.</p>
      <p>Nous vous prions d'agréer, Madame, Monsieur, nos salutations distinguées.</p>
      <p class="lettre-signature">L'équipe ${HO.nom}</p>
    </div>
    <div class="lettre-pied">Nous vous écrivons car votre projet figure dans la liste publique des autorisations d'urbanisme (base Sitadel du ministère chargé du Logement, n° ${echapper(f.num)}). Votre adresse n'est utilisée que pour ce courrier. Si vous ne souhaitez plus être contacté, il suffit de nous le dire par téléphone ou par e-mail : nous la supprimerons.</div>
  </section>`;
}

// Logo HO (immeubles stylisés dorés), utilisé dans l'en-tête et les courriers
const LOGO_SVG = `<svg class="logo" viewBox="0 0 64 48" aria-hidden="true"><g fill="none" stroke="#c9a24a" stroke-width="2.2" stroke-linejoin="round">
  <path d="M4 44h56"/><path d="M14 44V20l8-4v28"/><path d="M26 44V8l9 6v30"/><path d="M39 44V18l8 3v23"/><path d="M50 44V28l6 2v14"/>
  <path d="M30 44V16M43 44V24"/></g></svg>`;
