// =============================================================================
// journal.js — Journal interne, INVISIBLE dans l'appli.
// Enregistre les erreurs (bugs JavaScript, fichiers qui ne se chargent pas, appels au serveur
// qui échouent), les lenteurs et l'usage des fonctions (combien de fiches ouvertes, de
// courriers, d'exports…), puis les envoie au serveur toutes les minutes et quand on quitte
// l'appli. Le workflow « Rapport » les relit chaque jour et ouvre un ticket GitHub à analyser.
// Aucune donnée personnelle (adresses, notes) n'est envoyée.
// Chargé AVANT les autres scripts pour attraper aussi leurs erreurs.
// =============================================================================
"use strict";

const JOURNAL = (() => {
  let file = [];
  let compteurs = {};
  try {
    file = JSON.parse(localStorage.getItem("journal_file")) || [];
    compteurs = JSON.parse(localStorage.getItem("journal_compteurs")) || {};
  } catch (e) { /* stockage indisponible : tant pis */ }

  function garder() {
    try {
      localStorage.setItem("journal_file", JSON.stringify(file.slice(-100)));
      localStorage.setItem("journal_compteurs", JSON.stringify(compteurs));
    } catch (e) { /* plein ou indisponible */ }
  }

  function appareil() {
    const standalone = window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone;
    return [
      navigator.userAgent,
      `écran ${screen.width}x${screen.height}`,
      standalone ? "appli installée" : "navigateur",
      navigator.connection?.effectiveType ? `réseau ${navigator.connection.effectiveType}` : "",
      navigator.onLine ? "" : "hors-ligne",
    ].filter(Boolean).join(" · ");
  }

  return {
    /** Erreur ou événement à analyser (type court, message, détail). */
    noter(type, msg, detail = "") {
      file.push({ type, msg: String(msg).slice(0, 300), detail: String(detail).slice(0, 1500), t: new Date().toISOString() });
      garder();
    },
    /** Compteur d'usage (ex. « fiche », « courriers »). */
    compter(nom, n = 1) {
      compteurs[nom] = (compteurs[nom] || 0) + n;
      garder();
    },
    /** Envoi au serveur (si réseau). */
    envoyer() {
      if (!navigator.onLine || (!file.length && !Object.keys(compteurs).length)) return;
      const corps = JSON.stringify({ evenements: file.slice(0, 50), compteurs, appareil: appareil() });
      const blob = new Blob([corps], { type: "application/json" });
      if (navigator.sendBeacon && navigator.sendBeacon("/api/journal", blob)) {
        file = file.slice(50);
        compteurs = {};
        garder();
      }
    },
  };
})();

// Bugs JavaScript et fichiers qui ne se chargent pas (ex. bibliothèque de la carte)
window.addEventListener("error", (e) => {
  const cible = e.target;
  if (cible && cible !== window && (cible.src || cible.href)) {
    JOURNAL.noter("chargement", `Fichier non chargé : ${cible.src || cible.href}`);
  } else {
    JOURNAL.noter("erreur-js", e.message || "Erreur", `${e.filename || ""}:${e.lineno || ""}:${e.colno || ""}\n${e.error?.stack || ""}`);
  }
}, true);
window.addEventListener("unhandledrejection", (e) => {
  JOURNAL.noter("promesse", e.reason?.message || String(e.reason), e.reason?.stack || "");
});

// Envoi toutes les minutes et quand l'appli passe en arrière-plan
setInterval(() => JOURNAL.envoyer(), 60000);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") JOURNAL.envoyer(); });
window.addEventListener("online", () => JOURNAL.envoyer());
