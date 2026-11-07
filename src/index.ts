// =============================================================================
// index.ts — Le "serveur" de l'appli de prospection (Cloudflare Worker).
//
// Rôle :
//   1. Protéger toute l'appli par un mot de passe (secret APP_PASSWORD).
//   2. Servir les fichiers de l'appli (dossier public/ : page, script, données).
//   3. Garder en ligne le suivi des prospects (statut + note) et la date de la
//      dernière consultation des nouveautés, dans le stockage KV "SUIVI".
//
// Routes :
//   POST /api/connexion   {motdepasse}        → ouvre une session (cookie)
//   GET  /api/deconnexion                     → ferme la session
//   GET  /api/suivi                           → {suivi, vue}
//   POST /api/suivi       {id, s, n}          → enregistre statut (s) et note (n) d'un dossier
//   POST /api/suivi       {ids: [...], s}     → même statut pour plusieurs dossiers (courriers)
//   POST /api/vue         {maj}               → marque les nouveautés comme vues
//   tout le reste                             → fichiers de public/ (si connecté)
// =============================================================================

import { PAGE_CONNEXION } from "./connexion";

// Ce que Cloudflare met à disposition du code (wrangler.toml + secrets).
export interface Env {
  ASSETS: Fetcher; // fichiers du dossier public/
  SUIVI: KVNamespace; // stockage du suivi des prospects
  APP_PASSWORD: string; // mot de passe de l'appli (secret GitHub APP_PASSWORD)
}

const COOKIE = "pp_session";
const DUREE_SESSION = 180 * 24 * 3600; // 6 mois, en secondes

// Statuts autorisés pour un prospect (mêmes codes que dans public/app.js)
const STATUTS = ["", "a_contacter", "courrier", "contacte", "interesse", "signe", "refus"];

/** Réponse JSON (UTF-8 pour les accents). */
function json(data: unknown, status = 200, entetes: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...entetes },
  });
}

/**
 * Jeton de session = signature HMAC calculée avec le mot de passe.
 * Pas besoin de stocker les sessions : si le mot de passe change, toutes les
 * sessions existantes deviennent invalides automatiquement.
 */
async function signer(texte: string, cle: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(cle),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(texte));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function jetonSession(env: Env): Promise<string> {
  return signer("prospection-permis/session/v1", env.APP_PASSWORD);
}

/** Lit un cookie de la requête. */
function lireCookie(req: Request, nom: string): string {
  const brut = req.headers.get("cookie") || "";
  for (const morceau of brut.split(";")) {
    const [k, ...v] = morceau.trim().split("=");
    if (k === nom) return v.join("=");
  }
  return "";
}

async function estConnecte(req: Request, env: Env): Promise<boolean> {
  if (!env.APP_PASSWORD) return false; // sécurité : sans mot de passe configuré, tout est fermé
  const recu = lireCookie(req, COOKIE);
  return recu.length > 0 && recu === (await jetonSession(env));
}

/** POST /api/connexion : vérifie le mot de passe et pose le cookie de session. */
async function connexion(req: Request, env: Env): Promise<Response> {
  const corps = (await req.json().catch(() => ({}))) as { motdepasse?: string };
  const essai = String(corps.motdepasse || "");
  // Comparaison des signatures (même longueur) plutôt que des mots de passe en clair
  const ok =
    !!env.APP_PASSWORD &&
    (await signer("verif", essai)) === (await signer("verif", env.APP_PASSWORD));
  if (!ok) {
    await new Promise((r) => setTimeout(r, 800)); // freine les essais en rafale
    return json({ ok: false, message: "Mot de passe incorrect" }, 401);
  }
  const cookie = `${COOKIE}=${await jetonSession(env)}; Path=/; Max-Age=${DUREE_SESSION}; HttpOnly; Secure; SameSite=Lax`;
  return json({ ok: true }, 200, { "set-cookie": cookie });
}

// ----- Suivi des prospects (stockage KV) -------------------------------------

type Suivi = Record<string, { s?: string; n?: string; m: string }>;

async function lireSuivi(env: Env): Promise<Suivi> {
  return ((await env.SUIVI.get("suivi", "json")) as Suivi | null) || {};
}

async function routeSuivi(req: Request, env: Env): Promise<Response> {
  if (req.method === "GET") {
    const vue = (await env.SUIVI.get("vue")) || "";
    return json({ suivi: await lireSuivi(env), vue });
  }
  if (req.method !== "POST") return json({ erreur: "Méthode non permise" }, 405);

  const c = (await req.json().catch(() => ({}))) as { id?: string; s?: string; n?: string; ids?: unknown };

  // Mise à jour groupée du statut (ex. « Courrier envoyé » après une impression) : notes conservées
  if (Array.isArray(c.ids)) {
    const s = String(c.s || "");
    const ids = c.ids.map((x) => String(x).slice(0, 80)).filter(Boolean).slice(0, 500);
    if (!s || !STATUTS.includes(s)) return json({ erreur: "Statut invalide" }, 400);
    const suivi = await lireSuivi(env);
    const maintenant = new Date().toISOString();
    const entrees: Suivi = {};
    for (const id of ids) {
      // On ne rétrograde pas un prospect déjà plus avancé (contacté, intéressé, signé…)
      const ancien = suivi[id];
      if (ancien?.s && ancien.s !== "a_contacter" && ancien.s !== s) continue;
      suivi[id] = { s, n: ancien?.n || "", m: maintenant };
      entrees[id] = suivi[id];
    }
    await env.SUIVI.put("suivi", JSON.stringify(suivi));
    return json({ ok: true, entrees });
  }

  const id = String(c.id || "").slice(0, 80);
  const s = String(c.s || "");
  const n = String(c.n || "").slice(0, 4000);
  if (!id || !STATUTS.includes(s)) return json({ erreur: "Données invalides" }, 400);

  const suivi = await lireSuivi(env);
  if (!s && !n) delete suivi[id]; // plus rien à retenir sur ce dossier
  else suivi[id] = { s, n, m: new Date().toISOString() };
  await env.SUIVI.put("suivi", JSON.stringify(suivi));
  return json({ ok: true, entree: suivi[id] || null });
}

async function routeVue(req: Request, env: Env): Promise<Response> {
  if (req.method !== "POST") return json({ erreur: "Méthode non permise" }, 405);
  const c = (await req.json().catch(() => ({}))) as { maj?: string };
  const maj = String(c.maj || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(maj)) return json({ erreur: "Date invalide" }, 400);
  await env.SUIVI.put("vue", maj);
  return json({ ok: true, vue: maj });
}

// ----- Point d'entrée --------------------------------------------------------

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const chemin = url.pathname;

    if (chemin === "/api/connexion" && req.method === "POST") return connexion(req, env);
    if (chemin === "/api/deconnexion") {
      return new Response(null, {
        status: 302,
        headers: { location: "/", "set-cookie": `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax` },
      });
    }

    // Icônes et manifeste (installation sur l'écran d'accueil) : publics, sans données
    if (chemin.startsWith("/icones/") || chemin === "/manifest.webmanifest") return env.ASSETS.fetch(req);

    // Tout le reste exige d'être connecté
    if (!(await estConnecte(req, env))) {
      if (chemin.startsWith("/api/") || chemin.startsWith("/data/")) {
        return json({ erreur: "Non connecté" }, 401);
      }
      // (code 401 : le mode hors-ligne de l'appli ne garde jamais cette page en copie)
      return new Response(PAGE_CONNEXION, {
        status: 401,
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
    }

    try {
      if (chemin === "/api/suivi") return await routeSuivi(req, env);
      if (chemin === "/api/vue") return await routeVue(req, env);
      if (chemin.startsWith("/api/")) return json({ erreur: "Route inconnue" }, 404);
    } catch (e) {
      console.log("Erreur :", (e as Error).stack ?? String(e));
      return json({ erreur: "Erreur interne : " + (e as Error).message }, 500);
    }

    // Fichiers de l'appli : toujours revalidés (privés, jamais mis en cache partagé)
    const rep = await env.ASSETS.fetch(req);
    const copie = new Response(rep.body, rep);
    copie.headers.set("cache-control", "private, no-cache");
    return copie;
  },
} satisfies ExportedHandler<Env>;
