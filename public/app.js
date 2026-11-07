// =============================================================================
// app.js — Appli de prospection : liste, filtres, fiche, carte, suivi, export.
// Les données viennent de /data/permis.json (préparé par le robot, robot.py).
// Le suivi (statut + note de chaque prospect) est gardé en ligne via /api/suivi.
// =============================================================================
"use strict";

// ----- Libellés --------------------------------------------------------------
const TYPES = { PC: "Permis de construire", DP: "Déclaration préalable", PD: "Permis de démolir", PA: "Permis d'aménager", VT: "Vente récente" };
const DEPS = { "54": "54", "55": "55", "57": "57", "88": "88" };
const STATUTS = {
  a_contacter: { nom: "À contacter", couleur: "#2563eb" },
  courrier: { nom: "Courrier envoyé", couleur: "#7c3aed" },
  contacte: { nom: "Contacté", couleur: "#0891b2" },
  interesse: { nom: "Intéressé", couleur: "#ea580c" },
  signe: { nom: "Signé ✓", couleur: "#16a34a" },
  refus: { nom: "Pas intéressé", couleur: "#6b7280" },
};
const OPTIONS = { piscine: "Piscine", garage: "Garage", veranda: "Véranda", abri: "Abri de jardin", extension: "Extension", surelevation: "Surélévation", niveau: "Niveau en plus", photovoltaique: "Photovoltaïque" };
const DESTINATIONS = { 1: "Habitation", 2: "Hôtel", 3: "Bureaux", 4: "Commerce", 6: "Industrie", 7: "Bâtiment agricole", 8: "Entrepôt", 9: "Équipement public" };
const UTILISATION = { 1: "Pour y habiter / l'utiliser", 2: "Pour vendre", 3: "Pour louer", 4: "Vente et location" };

// Choix proposés dans le panneau des filtres
const CHOIX = {
  deps: Object.entries(DEPS),
  dem: [["tous", "Tous"], ["particulier", "Particuliers"], ["societe", "Sociétés"]],
  types: Object.entries(TYPES),
  projet: [["maison", "Maison neuve"], ["logements", "Plusieurs logements"], ["existant", "Travaux sur l'existant"], ["local", "Local d'activité / agricole"], ["achat", "Maison achetée"], ["achat_local", "Local acheté"]],
  chantier: [["avant", "Pas commencé"], ["encours", "En cours"], ["fini", "Terminé"]],
  options: Object.entries(OPTIONS).filter(([k]) => k !== "niveau"),
  periode: [["1", "1 mois"], ["3", "3 mois"], ["6", "6 mois"], ["12", "12 mois"]],
  interet: [["3", "🔥🔥🔥 Très chaud"], ["2", "🔥🔥 Chaud"], ["1", "🔥 Tiède"], ["0", "❄️ Froid"]],
  rayon: [["20", "20 km"], ["40", "40 km"], ["60", "60 km"], ["tout", "Toute la zone"]],
  statut: [["tous", "Tous"], ["aucun", "Sans statut"], ...Object.entries(STATUTS).map(([k, v]) => [k, v.nom])],
};
// Filtres à choix unique (les autres sont à choix multiples ; vide = tout)
const UNIQUES = new Set(["dem", "periode", "statut", "rayon"]);

function filtresParDefaut() {
  return { q: "", deps: [], dem: "tous", types: [], projet: [], chantier: [], options: [], interet: [], rayon: "tout", periode: "12", statut: "tous", tri: "chaleur", nouveaux: false };
}

// ----- État de l'appli -------------------------------------------------------
const E = {
  donnees: null, // contenu de permis.json
  permis: [],
  suivi: {}, // { id: {s, n, m} }
  vue: "", // date des données lors du dernier « marquer comme vus »
  filtres: chargerFiltres(),
  onglet: "liste",
  limite: 60, // nombre de cartes affichées dans la liste (augmente avec « Afficher plus »)
  resultats: [],
  carte: null,
  calque: null,
};

// ----- Petites aides ---------------------------------------------------------
const $ = (s) => document.querySelector(s);
const echapper = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dateFr = (d) => (d && d.length >= 10 ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "");
const PETITS_MOTS = new Set(["de", "du", "des", "la", "le", "les", "d", "l", "et", "en", "sur", "aux", "au", "a"]);
function joli(s) {
  // « RUE DE L'ABBAYE » → « Rue de l'Abbaye »
  return String(s || "").toLowerCase().replace(/[a-zàâäçéèêëîïôöùûüÿœ]+/g, (m, i) => (i > 0 && PETITS_MOTS.has(m) ? m : m[0].toUpperCase() + m.slice(1)));
}
function sauver(cle, valeur) {
  try { localStorage.setItem(cle, JSON.stringify(valeur)); } catch (e) { /* navigation privée : tant pis */ }
}
function chargerFiltres() {
  try { return { ...filtresParDefaut(), ...(JSON.parse(localStorage.getItem("filtres_ho")) || {}), nouveaux: false }; } catch (e) { return filtresParDefaut(); }
}
async function api(chemin, corps) {
  const r = await fetch(chemin, corps ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corps) } : {});
  if (r.status === 401) { location.reload(); throw new Error("Session expirée"); }
  if (!r.ok) throw new Error(`Erreur ${r.status}`);
  return r.json();
}

// ----- Interprétation d'un dossier -------------------------------------------
function chantier(f) {
  if (f.src === "V") return "vente";
  if (f.e === 6 || f.df) return "fini";
  if (f.e === 5 || f.dd) return "encours";
  return "avant";
}
const CHANTIER_NOM = { avant: "Pas commencé", encours: "Chantier en cours", fini: "Terminé", vente: "Vendu" };
const euros = (n) => (n || 0).toLocaleString("fr-FR") + " €";
const estParticulier = (f) => !f.dem && !f.siret; // (acheteurs DVF : jamais publiés → comptés comme particuliers)
const estNouveau = (f) => !!E.vue && f.vu > E.vue;

function projet(f) {
  // Catégorie utilisée par le filtre « Projet »
  if (f.src === "V") return f.bien === "maison" ? "achat" : "achat_local";
  if (f.t === "PD" || f.t === "PA") return "";
  if (f.src.includes("L") && f.nat === 1) return f.tl === 1 ? "maison" : "logements";
  if (f.src.includes("L")) return "existant";
  return "local";
}

function libelle(f) {
  // Phrase courte qui résume le projet
  let txt;
  if (f.src === "V") {
    if (f.bien === "maison") return `Maison achetée · ${f.sb} m²${f.pp ? ` · ${f.pp} p.` : ""}${f.ratio && f.ratio < 0.8 ? " · prix bas" : ""}`;
    return `Local commercial acheté${f.sb ? ` · ${f.sb} m²` : ""}`;
  }
  if (f.t === "PD") txt = f.dem ? "Démolition" : "Démolition (particulier)";
  else if (f.t === "PA") txt = "Aménagement / lotissement";
  else if (f.src.includes("L")) {
    const lg = f.lg || 1;
    if (f.nat === 1) txt = { 1: "Maison individuelle neuve", 2: `${lg} maisons neuves`, 3: `Immeuble de ${lg} logements`, 4: `Résidence de ${lg} logements` }[f.tl] || "Logement neuf";
    else if (f.nat === 3) txt = "Extension + transformation";
    else if (f.nat === 5) txt = "Extension";
    else if (f.nat === 2) txt = "Transformation / création de logement";
    else txt = "Travaux sur logement";
  } else {
    const dest = DESTINATIONS[f.dest] || "Local";
    txt = (f.nat === 1 ? "Nouveau bâtiment : " : "Travaux : ") + dest.toLowerCase();
  }
  const surface = (f.sh || 0) + (f.sl || 0);
  if (surface) txt += ` · ${surface} m²`;
  return txt;
}

function adresseComplete(f) {
  const rue = [joli(f.adr), joli(f.ld)].filter(Boolean).join(", ");
  return [rue, [f.cp, joli(f.ville)].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}

// ----- Filtrage --------------------------------------------------------------
function moisAvant(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}

function filtrer(pourSuivi) {
  const F = E.filtres;
  const q = F.q.trim().toLowerCase();
  const depuis = moisAvant(Number(F.periode) || 12);
  const res = E.permis.filter((f) => {
    const s = E.suivi[f.id]?.s || "";
    if (pourSuivi) return !!(s || E.suivi[f.id]?.n);
    if (F.nouveaux && !estNouveau(f)) return false;
    if (F.deps.length && !F.deps.includes(f.dep)) return false;
    if (F.dem === "particulier" && !estParticulier(f)) return false;
    if (F.dem === "societe" && estParticulier(f)) return false;
    if (F.types.length && !F.types.includes(f.t)) return false;
    if (F.projet.length && !F.projet.includes(projet(f))) return false;
    if (F.chantier.length && !F.chantier.includes(chantier(f))) return false;
    if (F.options.length && !F.options.some((o) => (f.opt || []).includes(o))) return false;
    if (f.src !== "V" && (f.da || "") < depuis) return false;
    if (F.interet.length && !F.interet.includes(String(noteHO(f).niveau))) return false;
    if (F.rayon !== "tout") {
      const d = distanceToul(f);
      if (d == null || d > Number(F.rayon)) return false;
    }
    if (F.statut === "aucun" && s) return false;
    if (F.statut !== "tous" && F.statut !== "aucun" && s !== F.statut) return false;
    if (q) {
      const texte = `${f.adr} ${f.ld} ${f.ville} ${f.cp} ${f.dem} ${f.num} ${f.dville}`.toLowerCase();
      if (!q.split(/\s+/).every((mot) => texte.includes(mot))) return false;
    }
    return true;
  });
  const tri = pourSuivi ? "suivi" : F.tri;
  const cmp = {
    recent: (a, b) => (b.da || "").localeCompare(a.da || ""),
    ancien: (a, b) => (a.da || "").localeCompare(b.da || ""),
    commune: (a, b) => (a.ville || "").localeCompare(b.ville || "", "fr") || (b.da || "").localeCompare(a.da || ""),
    surface: (a, b) => ((b.sh || 0) + (b.sl || 0)) - ((a.sh || 0) + (a.sl || 0)),
    chaleur: (a, b) => noteHO(b).points - noteHO(a).points || (b.da || "").localeCompare(a.da || ""),
    proche: (a, b) => (distanceToul(a) ?? 999) - (distanceToul(b) ?? 999),
    suivi: (a, b) => (E.suivi[b.id]?.m || "").localeCompare(E.suivi[a.id]?.m || ""),
  }[tri];
  return res.sort(cmp);
}

function nbFiltresActifs() {
  const F = E.filtres, D = filtresParDefaut();
  let n = 0;
  for (const k of ["deps", "types", "projet", "chantier", "options", "interet"]) if (F[k].length) n++;
  for (const k of ["dem", "periode", "statut", "rayon"]) if (F[k] !== D[k]) n++;
  if (F.nouveaux) n++;
  return n;
}

// ----- Affichage : panneau des filtres ---------------------------------------
function dessinerFiltres() {
  document.querySelectorAll(".puces[data-filtre]").forEach((zone) => {
    const cle = zone.dataset.filtre;
    zone.innerHTML = CHOIX[cle].map(([val, nom]) => {
      const actif = UNIQUES.has(cle) ? E.filtres[cle] === val : E.filtres[cle].includes(val);
      return `<button class="puce${actif ? " actif" : ""}" data-val="${echapper(val)}">${echapper(nom)}</button>`;
    }).join("");
  });
  $("#tri").value = E.filtres.tri;
  const n = nbFiltresActifs();
  $("#nb-filtres").hidden = !n;
  $("#nb-filtres").textContent = n;
}

document.querySelectorAll(".puces[data-filtre]").forEach((zone) => {
  zone.addEventListener("click", (e) => {
    const b = e.target.closest(".puce");
    if (!b) return;
    const cle = zone.dataset.filtre, val = b.dataset.val;
    if (UNIQUES.has(cle)) E.filtres[cle] = val;
    else {
      const liste = E.filtres[cle];
      E.filtres[cle] = liste.includes(val) ? liste.filter((x) => x !== val) : [...liste, val];
    }
    changementFiltres();
  });
});

function changementFiltres() {
  sauver("filtres_ho", { ...E.filtres, nouveaux: false });
  E.limite = 60;
  dessinerFiltres();
  rafraichir();
}

// ----- Affichage : liste -----------------------------------------------------
function badgeInteret(f) {
  const n = NIVEAUX[noteHO(f).niveau];
  return `<span class="interet ${n.classe}">${n.icone} ${n.nom}</span>`;
}
function distanceTexte(f) {
  const d = distanceToul(f);
  return d == null ? "" : `à ${Math.round(d)} km de Toul`;
}

function carteDossier(f) {
  const ch = chantier(f);
  const s = E.suivi[f.id]?.s;
  return `<article class="dossier" data-id="${echapper(f.id)}">
    <div class="l1"><span class="badge ${f.t}">${f.t}</span><span class="projet">${echapper(libelle(f))}</span>${estNouveau(f) ? '<span class="nouveau">NOUVEAU</span>' : ""}</div>
    <div class="adresse">${echapper(joli(f.adr) || joli(f.ld) || "Adresse non précisée")}</div>
    <div class="ville">${echapper(f.cp)} ${echapper(joli(f.ville))}${distanceTexte(f) ? " · " + distanceTexte(f) : ""}${f.dem ? `<br><b>${echapper(f.dem)}</b>` : ""}</div>
    <div class="l3">${badgeInteret(f)}<span class="etat ${ch}">${CHANTIER_NOM[ch]}</span><span>${f.src === "V" ? "vendu le" : "autorisé le"} ${dateFr(f.da)}</span>
      ${s ? `<span class="statut" style="background:${STATUTS[s].couleur}">${STATUTS[s].nom}</span>` : ""}
      ${E.suivi[f.id]?.n ? "<span>📝</span>" : ""}</div>
  </article>`;
}

function dessinerListe() {
  const zone = $("#vue-liste");
  const r = E.resultats;
  if (!r.length) {
    zone.innerHTML = `<div class="vide">${E.onglet === "suivi" ? "Aucun prospect suivi pour l'instant.<br>Ouvre un dossier et choisis un statut." : "Aucun dossier ne correspond à ces filtres."}</div>`;
    return;
  }
  zone.innerHTML = r.slice(0, E.limite).map(carteDossier).join("") +
    (r.length > E.limite ? `<button class="plus" id="plus">Afficher plus (${r.length - E.limite} restants)</button>` : "");
}

$("#vue-liste").addEventListener("click", (e) => {
  if (e.target.id === "plus") { E.limite += 100; dessinerListe(); return; }
  const c = e.target.closest(".dossier");
  if (c) ouvrirFiche(c.dataset.id);
});

// ----- Affichage : carte -----------------------------------------------------
function couleurPoint(f) {
  const s = E.suivi[f.id]?.s;
  if (s) return STATUTS[s].couleur;
  return { 3: "#dc2626", 2: "#f97316", 1: "#eab308", 0: "#9ca3af" }[noteHO(f).niveau];
}

function dessinerCarte() {
  if (!window.L) { $("#carte").innerHTML = '<div class="vide">Carte indisponible (pas de connexion ?)</div>'; return; }
  if (!E.carte) {
    E.carte = L.map("carte", { zoomControl: true }).setView([48.75, 6.3], 8);
    // Repère du siège de HO à Toul
    L.marker([HO.base.lat, HO.base.lon], {
      icon: L.divIcon({ className: "repere-ho", html: "HO", iconSize: [34, 34] }),
      zIndexOffset: 1000,
    }).addTo(E.carte).bindPopup(`<b>${HO.nom}</b><br>${HO.ville}`);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: "© OpenStreetMap",
    }).addTo(E.carte);
    E.calque = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 45, chunkedLoading: true });
    E.carte.addLayer(E.calque);
    E.carte.on("popupopen", (e) => {
      const b = e.popup.getElement().querySelector("[data-ouvrir]");
      if (b) b.addEventListener("click", () => ouvrirFiche(b.dataset.ouvrir));
    });
  }
  setTimeout(() => E.carte.invalidateSize(), 50);
  E.calque.clearLayers();
  const points = [];
  for (const f of E.resultats) {
    if (f.lat == null) continue;
    const m = L.circleMarker([f.lat, f.lon], { radius: 8, color: "#fff", weight: 2, fillColor: couleurPoint(f), fillOpacity: 0.95 });
    m.bindPopup(`<b>${echapper(libelle(f))}</b><br>${echapper(adresseComplete(f))}<br>
      <small>${NIVEAUX[noteHO(f).niveau].icone} ${NIVEAUX[noteHO(f).niveau].nom} · ${f.src === "V" ? `vendu le ${dateFr(f.da)}` : `${f.t} autorisé le ${dateFr(f.da)} · ${CHANTIER_NOM[chantier(f)]}`}</small><br>
      <button data-ouvrir="${echapper(f.id)}">Ouvrir la fiche</button>`);
    points.push(m);
  }
  E.calque.addLayers(points);
  if (points.length) E.carte.fitBounds(E.calque.getBounds(), { padding: [20, 20], maxZoom: 15 });
}

$("#me-localiser").addEventListener("click", () => {
  if (!E.carte) return;
  E.carte.locate({ setView: true, maxZoom: 15 });
  E.carte.once("locationfound", (e) => L.circleMarker(e.latlng, { radius: 7, color: "#1d4ed8", fillOpacity: 1 }).addTo(E.carte));
  E.carte.once("locationerror", () => alert("Position introuvable (autorise la localisation dans Safari)."));
});

// ----- Rafraîchissement général ----------------------------------------------
function rafraichir() {
  E.resultats = filtrer(E.onglet === "suivi");
  const total = E.resultats.length;
  const surCarte = E.resultats.filter((f) => f.lat != null).length;
  $("#compteur").textContent = E.onglet === "suivi"
    ? `${total} prospect${total > 1 ? "s" : ""} suivi${total > 1 ? "s" : ""}`
    : `${total} dossier${total > 1 ? "s" : ""}` + (E.onglet === "carte" && surCarte < total ? ` (${surCarte} placés sur la carte)` : "");
  const cacherBarre = E.onglet === "suivi";
  $(".barre").hidden = cacherBarre;
  if (cacherBarre) $("#filtres").hidden = true;
  $("#vue-liste").hidden = E.onglet === "carte";
  $("#vue-carte").hidden = E.onglet !== "carte";
  if (E.onglet === "carte") dessinerCarte(); else dessinerListe();
  dessinerBandeau();
}

document.querySelectorAll(".onglets button").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll(".onglets button").forEach((x) => x.classList.toggle("actif", x === b));
  E.onglet = b.dataset.onglet;
  E.limite = 60;
  rafraichir();
  window.scrollTo(0, 0);
}));

let minuteur;
$("#recherche").addEventListener("input", (e) => {
  clearTimeout(minuteur);
  minuteur = setTimeout(() => { E.filtres.q = e.target.value; E.limite = 60; rafraichir(); }, 200);
});
$("#bouton-filtres").addEventListener("click", () => { $("#filtres").hidden = !$("#filtres").hidden; });
$("#fermer-filtres").addEventListener("click", () => { $("#filtres").hidden = true; });
$("#reinitialiser").addEventListener("click", () => { E.filtres = { ...filtresParDefaut(), q: E.filtres.q }; changementFiltres(); });
$("#tri").addEventListener("change", (e) => { E.filtres.tri = e.target.value; changementFiltres(); });

// ----- Nouveautés ------------------------------------------------------------
function dessinerBandeau() {
  const n = E.permis.filter(estNouveau).length;
  $("#bandeau").hidden = !n;
  $("#bandeau-texte").textContent = `🆕 ${n} nouveau${n > 1 ? "x" : ""} dossier${n > 1 ? "s" : ""} depuis ta dernière visite`;
  $("#voir-nouveaux").textContent = E.filtres.nouveaux ? "Tout voir" : "Voir";
}
$("#voir-nouveaux").addEventListener("click", () => {
  E.filtres.nouveaux = !E.filtres.nouveaux;
  if (E.filtres.nouveaux && E.onglet === "suivi") document.querySelector('[data-onglet="liste"]').click();
  changementFiltres();
});
$("#marquer-vus").addEventListener("click", async () => {
  await api("/api/vue", { maj: E.donnees.maj });
  E.vue = E.donnees.maj;
  E.filtres.nouveaux = false;
  changementFiltres();
});

// ----- Fiche détaillée -------------------------------------------------------
function ligne(nom, valeur) {
  return valeur ? `<div class="ligne"><span>${nom}</span><span>${valeur}</span></div>` : "";
}

// Bloc « Vente » de la fiche (ventes DVF)
function blocVente(f) {
  let comparaison = "";
  if (f.ratio) {
    const ecart = Math.round((f.ratio - 1) * 100);
    const ou = f.med_dep ? "du département" : "de la commune";
    comparaison = ecart <= -20
      ? `<div class="remarque">💡 Vendue <b>${-ecart} % moins cher</b> que la moyenne ${ou} (${euros(f.med)}/m²) : sans doute une maison à vider et à rénover.</div>`
      : `<div class="remarque">Prix ${ecart >= 0 ? "+" : ""}${ecart} % par rapport à la moyenne ${ou} (${euros(f.med)}/m²).</div>`;
  }
  const permis = (f.pc || []).map((id) => E.permis.find((x) => x.id === id)).filter(Boolean);
  return `<div class="bloc">
      <h3>🏠 Vente</h3>
      ${ligne("Vendu le", dateFr(f.da))}
      ${ligne("Prix", euros(f.prix))}
      ${ligne("Bien", f.bien === "maison" ? "Maison" : "Local commercial / industriel")}
      ${ligne("Surface", f.sb ? `${f.sb} m²` : "")}
      ${ligne("Pièces", f.pp ? String(f.pp) : "")}
      ${ligne("Prix au m²", f.pm2 ? euros(f.pm2) : "")}
      ${f.nat_v === "Adjudication" ? '<div class="remarque">Vendu aux enchères (adjudication).</div>' : ""}
      ${comparaison}
      ${permis.map((p) => `<div class="remarque">🏗️ Le nouveau propriétaire a déposé un dossier : <a href="#" data-lien="${echapper(p.id)}">${echapper(libelle(p))} (${dateFr(p.da)})</a></div>`).join("")}
      <div class="remarque">Données publiques des ventes (DVF) : le nom de l'acheteur n'est pas publié.</div>
    </div>`;
}

function ouvrirFiche(id) {
  const f = E.permis.find((x) => x.id === id);
  if (!f) return;
  const suivi = E.suivi[id] || {};
  const adr = adresseComplete(f);
  const dest = f.lat != null ? `${f.lat},${f.lon}` : encodeURIComponent(adr);
  const geoportail = f.lat != null
    ? `https://www.geoportail.gouv.fr/carte?c=${f.lon},${f.lat}&z=19&l0=ORTHOIMAGERY.ORTHOPHOTOS::GEOPORTAIL:OGC:WMTS(1)&l1=CADASTRALPARCELS.PARCELLAIRE_EXPRESS::GEOPORTAIL:OGC:WMTS(1)&permalink=yes`
    : "";
  const ch = chantier(f);
  const opts = (f.opt || []).map((o) => OPTIONS[o]).filter(Boolean).join(", ");
  const autreVille = f.dville && f.ville && f.dville.toUpperCase() !== f.ville.toUpperCase();

  $("#fiche").innerHTML = `
    <div class="fiche-tete">
      <div><span class="badge ${f.t}">${f.t}</span> ${estNouveau(f) ? '<span class="nouveau">NOUVEAU</span>' : ""}
        <h2>${echapper(libelle(f))}</h2>
        <div class="sous-titre">${f.src === "V" ? `Vente du ${dateFr(f.da)} (DVF)` : `${TYPES[f.t] || f.t} n° ${echapper(f.num)}`}</div></div>
      <button class="fermer" id="fermer-fiche" aria-label="Fermer">✕</button>
    </div>

    <div class="bloc bloc-ho">
      <h3>🎯 Intérêt pour ${HO.nom}</h3>
      <div class="note-ho">${badgeInteret(f)} <span class="sous-titre">${distanceTexte(f)}</span></div>
      <ul class="raisons">${noteHO(f).raisons.map((r) => `<li>${echapper(r)}</li>`).join("")}</ul>
      <div class="sous-titre">À proposer :</div>
      <div class="services">${noteHO(f).services.map((k) => `<span>${SERVICES[k]}</span>`).join("")}</div>
      <details class="accroche"><summary>📞 Phrase d'accroche</summary><p id="texte-accroche">${echapper(accroche(f))}</p>
        <button class="secondaire" id="copier-accroche">Copier</button></details>
      <div class="actions">
        <button id="courrier-un">✉️ Préparer le courrier</button>
        ${f.ent?.adr || !f.dem ? "" : '<span class="remarque">Adresse du siège inconnue : courrier envoyé à l\'adresse du chantier.</span>'}
      </div>
    </div>

    <div class="bloc">
      <h3>Mon suivi</h3>
      <div class="statuts" id="choix-statut">
        ${Object.entries(STATUTS).map(([k, v]) => `<button class="puce${suivi.s === k ? " actif" : ""}" data-s="${k}" style="${suivi.s === k ? `background:${v.couleur};border-color:${v.couleur}` : ""}">${v.nom}</button>`).join("")}
      </div>
      <textarea id="note" placeholder="Notes : appel, rendez-vous, devis…">${echapper(suivi.n || "")}</textarea>
      <button class="enregistrer" id="enregistrer">Enregistrer</button>
      <div class="message-ok" id="message-suivi"></div>
    </div>

    <div class="bloc">
      <h3>Adresse du chantier</h3>
      <div>${echapper(adr || "Non précisée")}</div>
      ${f.geo === "c" ? '<div class="remarque">⚠️ Position approximative : centre de la commune.</div>' : ""}
      ${f.geo === "r" ? '<div class="remarque">Position sur la rue (numéro non trouvé).</div>' : ""}
      <div class="actions">
        <a href="https://maps.apple.com/?daddr=${dest}" target="_blank" rel="noopener">🚗 Itinéraire (Plans)</a>
        <a href="https://www.google.com/maps/dir/?api=1&destination=${dest}" target="_blank" rel="noopener" class="secondaire">Google Maps</a>
        ${f.lat != null ? `<a href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${f.lat},${f.lon}" target="_blank" rel="noopener" class="secondaire">👁️ Street View</a>` : ""}
        ${geoportail ? `<a href="${geoportail}" target="_blank" rel="noopener" class="secondaire">🗺️ Cadastre</a>` : ""}
      </div>
    </div>

    ${f.src === "V" ? blocVente(f) : ""}
    ${f.achat ? `<div class="bloc"><h3>🏠 Bien acheté avant ce projet</h3>${ligne("Acheté le", dateFr(f.achat.d))}${ligne("Prix", euros(f.achat.prix))}<div class="remarque">Le propriétaire vient d'acheter puis dépose ce dossier : il prépare des travaux.</div></div>` : ""}

    <div class="bloc"${f.src === "V" ? " hidden" : ""}>
      <h3>Projet</h3>
      ${ligne("Type", TYPES[f.t] || f.t)}
      ${f.dest && f.src.includes("N") ? ligne("Destination", DESTINATIONS[f.dest] || "") : ""}
      ${ligne("Logements créés", f.lg ? String(f.lg) : "")}
      ${ligne("Surface habitable créée", f.sh ? `${f.sh} m²` : "")}
      ${ligne("Surface d'activité créée", f.sl ? `${f.sl} m²` : "")}
      ${ligne("Comprend", echapper(opts))}
      ${ligne("Niveaux", f.niv ? String(f.niv) : "")}
      ${ligne("Utilisation prévue", UTILISATION[f.ut] || "")}
      ${ligne("Résidence", { 1: "Principale", 2: "Secondaire" }[f.rp] || "")}
    </div>

    <div class="bloc"${f.src === "V" ? " hidden" : ""}>
      <h3>Calendrier</h3>
      ${ligne("État", `<span class="etat ${ch}">${CHANTIER_NOM[ch]}</span>`)}
      ${ligne("Autorisé le", dateFr(f.da))}
      ${ligne("Chantier ouvert le", dateFr(f.dd))}
      ${ligne("Travaux terminés le", dateFr(f.df))}
      ${ligne("Ajouté dans l'appli le", dateFr(f.vu))}
    </div>

    <div class="bloc">
      <h3>${f.src === "V" ? "Acheteur" : "Demandeur"}</h3>
      ${f.dem
        ? `${ligne("Société", echapper(f.dem))}${ligne("Dirigeant", echapper(f.ent?.dir || ""))}${ligne("Siège", echapper(joli(f.ent?.adr || "")))}${f.ent && f.ent.actif === false ? '<div class="remarque">⚠️ Société fermée selon l\'annuaire.</div>' : ""}${ligne("SIRET", f.siret ? `<a href="https://annuaire-entreprises.data.gouv.fr/etablissement/${echapper(f.siret)}" target="_blank" rel="noopener">${echapper(f.siret)}</a>` : "")}
           <div class="actions"><a class="secondaire" href="https://www.google.com/search?q=${encodeURIComponent((f.ent?.nom || f.dem) + " " + (f.dville || "") + " téléphone")}" target="_blank" rel="noopener">🔎 Trouver le téléphone</a>
           ${f.ent?.dir ? `<a class="secondaire" href="https://www.google.com/search?q=${encodeURIComponent(f.ent.dir.replace(/\s*\(.*\)$/, "") + " " + (f.ent?.nom || f.dem))}" target="_blank" rel="noopener">🔎 Le dirigeant</a>` : ""}</div>`
        : ligne(f.src === "V" ? "Nom" : "Demandeur", f.src === "V" ? "Non publié" : "Particulier (nom non publié)")}
      ${ligne("Domicile", echapper([f.dcp, joli(f.dville)].filter(Boolean).join(" ")))}
      ${!f.dem && autreVille ? '<div class="remarque">💡 Habite une autre commune que celle du chantier : sans doute un nouvel arrivant.</div>' : ""}
    </div>

    <div class="bloc">
      <h3>Terrain</h3>
      ${ligne("Parcelles", echapper((f.cad || []).join(", ")))}
      ${ligne("Superficie", f.st ? `${f.st.toLocaleString("fr-FR")} m²` : "")}
      ${ligne("Département", f.dep)}
    </div>`;

  $("#voile").hidden = false;
  $("#fiche").hidden = false;
  $("#fiche").scrollTop = 0;

  let statut = suivi.s || "";
  $("#choix-statut").addEventListener("click", (e) => {
    const b = e.target.closest(".puce");
    if (!b) return;
    statut = statut === b.dataset.s ? "" : b.dataset.s; // 2e appui = retirer le statut
    document.querySelectorAll("#choix-statut .puce").forEach((x) => {
      const actif = x.dataset.s === statut;
      x.classList.toggle("actif", actif);
      x.style.background = actif ? STATUTS[x.dataset.s].couleur : "";
      x.style.borderColor = actif ? STATUTS[x.dataset.s].couleur : "";
    });
    enregistrer(id, statut);
  });
  $("#enregistrer").addEventListener("click", () => enregistrer(id, statut));
  $("#courrier-un").addEventListener("click", () => { fermerFiche(); ouvrirCourriers([f]); });
  $("#copier-accroche").addEventListener("click", async (e) => {
    try { await navigator.clipboard.writeText($("#texte-accroche").textContent); e.target.textContent = "Copié ✓"; } catch (x) { e.target.textContent = "Copie impossible"; }
  });
  $("#fermer-fiche").addEventListener("click", fermerFiche);
  document.querySelectorAll("#fiche [data-lien]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); ouvrirFiche(a.dataset.lien); }));
}

async function enregistrer(id, statut) {
  const note = $("#note").value.trim();
  const msg = $("#message-suivi");
  msg.textContent = "Enregistrement…";
  try {
    const r = await api("/api/suivi", { id, s: statut, n: note });
    if (r.entree) E.suivi[id] = r.entree; else delete E.suivi[id];
    msg.textContent = "Enregistré ✓";
  } catch (e) {
    msg.textContent = "⚠️ Pas enregistré : " + e.message;
  }
}

function fermerFiche() {
  $("#fiche").hidden = true;
  $("#voile").hidden = true;
  rafraichir(); // le statut a pu changer
}
$("#voile").addEventListener("click", fermerFiche);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#fiche").hidden) fermerFiche(); });

// ----- Export CSV (s'ouvre dans Excel) ---------------------------------------
function exporter() {
  const lignes = E.resultats;
  if (!lignes.length) { alert("Aucun dossier à exporter."); return; }
  const entetes = ["Intérêt HO", "Points", "Distance de Toul (km)", "À proposer", "Numéro", "Type", "Projet", "Autorisé le", "État du chantier", "Chantier ouvert le", "Terminé le",
    "Logements créés", "Surface habitable créée (m²)", "Surface d'activité créée (m²)", "Comprend",
    "Adresse", "Lieu-dit", "Code postal", "Commune", "Département", "Demandeur", "SIRET",
    "Domicile du demandeur", "Prix de vente (€)", "Prix au m² (€)", "Écart / moyenne commune (%)", "Dirigeant", "Siège de la société", "Parcelles", "Terrain (m²)", "Latitude", "Longitude", "Nouveau", "Statut", "Note", "Suivi mis à jour"];
  const cellule = (v) => {
    const s = String(v ?? "");
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const corps = lignes.map((f) => {
    const s = E.suivi[f.id] || {};
    const note = noteHO(f), d = distanceToul(f);
    return [NIVEAUX[note.niveau].nom, note.points, d == null ? "" : Math.round(d), note.services.map((k) => SERVICES[k]).join(", "),
      f.num, TYPES[f.t] || f.t, libelle(f), dateFr(f.da), CHANTIER_NOM[chantier(f)], dateFr(f.dd), dateFr(f.df),
      f.lg || "", f.sh || "", f.sl || "", (f.opt || []).map((o) => OPTIONS[o]).join(", "),
      joli(f.adr), joli(f.ld), f.cp, joli(f.ville), f.dep, f.dem || "Particulier", f.siret,
      [f.dcp, joli(f.dville)].filter(Boolean).join(" "), f.prix || "", f.pm2 || "", f.ratio ? Math.round((f.ratio - 1) * 100) : "", f.ent?.dir || "", f.ent?.adr || "", (f.cad || []).join(", "), f.st || "",
      f.lat ?? "", f.lon ?? "", estNouveau(f) ? "oui" : "", STATUTS[s.s]?.nom || "", s.n || "", s.m ? dateFr(s.m) : ""]
      .map(cellule).join(";");
  });
  // ; comme séparateur + BOM UTF-8 : Excel français l'ouvre directement avec les accents
  const csv = "﻿" + [entetes.join(";"), ...corps].join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `prospects_HO_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}
$("#bouton-export").addEventListener("click", exporter);

// ----- Courriers à imprimer --------------------------------------------------
const MAX_COURRIERS = 150;
let courriersEnCours = [];

function ouvrirCourriers(liste) {
  if (!liste.length) { alert("Aucun dossier dans la liste."); return; }
  if (liste.length > MAX_COURRIERS &&
      !confirm(`${liste.length} dossiers : seuls les ${MAX_COURRIERS} premiers (les plus intéressants selon le tri) seront préparés. Continuer ?`)) return;
  courriersEnCours = liste.slice(0, MAX_COURRIERS);
  $("#lettres").innerHTML = courriersEnCours.map(htmlCourrier).join("");
  $("#nb-courriers").textContent = `${courriersEnCours.length} courrier${courriersEnCours.length > 1 ? "s" : ""} — tu peux modifier le texte en touchant dessus`;
  $("#marquer-courriers").textContent = "✓ Marquer « Courrier envoyé »";
  document.body.classList.add("mode-courriers");
  window.scrollTo(0, 0);
}
function fermerCourriers() {
  document.body.classList.remove("mode-courriers");
  $("#lettres").innerHTML = "";
  rafraichir();
}
$("#bouton-courriers").addEventListener("click", () => ouvrirCourriers(E.resultats));
$("#imprimer").addEventListener("click", () => window.print());
$("#retour-courriers").addEventListener("click", fermerCourriers);
$("#marquer-courriers").addEventListener("click", async (e) => {
  const ids = courriersEnCours.map((f) => f.id);
  e.target.textContent = "Enregistrement…";
  try {
    const r = await api("/api/suivi", { ids, s: "courrier" });
    Object.assign(E.suivi, r.entrees || {});
    e.target.textContent = `✓ ${ids.length} marqués « Courrier envoyé »`;
  } catch (x) {
    e.target.textContent = "⚠️ Échec : " + x.message;
  }
});

// ----- Démarrage -------------------------------------------------------------
async function demarrer() {
  $("#logo-entete").innerHTML = LOGO_SVG;
  try {
    const [rep, suivi] = await Promise.all([fetch("/data/permis.json"), api("/api/suivi")]);
    if (rep.status === 401) { location.reload(); return; }
    if (!rep.ok) {
      $("#infos-donnees").textContent = "Pas encore de données";
      $("#vue-liste").innerHTML = '<div class="vide">Les données n\'ont pas encore été récupérées.<br>Lance le robot sur GitHub (Actions → « Robot de collecte » → Run workflow).</div>';
      return;
    }
    E.donnees = await rep.json();
    E.permis = E.donnees.permis || [];
    E.suivi = suivi.suivi || {};
    E.vue = suivi.vue || "";
    // Première ouverture : rien n'est « nouveau », on mémorise la date des données
    if (!E.vue && E.donnees.maj) {
      E.vue = E.donnees.maj;
      api("/api/vue", { maj: E.donnees.maj }).catch(() => {});
    }
    $("#infos-donnees").textContent =
      `${E.permis.length.toLocaleString("fr-FR")} prospects · permis jusqu'au ${dateFr(E.donnees.derniere_autorisation)}` +
      (E.donnees.derniere_vente ? ` · ventes jusqu'au ${dateFr(E.donnees.derniere_vente)}` : "") + ` · mis à jour le ${dateFr(E.donnees.maj)}`;
    $("#recherche").value = E.filtres.q;
    dessinerFiltres();
    rafraichir();
  } catch (e) {
    $("#infos-donnees").textContent = "Erreur de chargement";
    $("#vue-liste").innerHTML = `<div class="vide">Erreur : ${echapper(e.message)}<br>Vérifie ta connexion puis recharge la page.</div>`;
  }
}
demarrer();
