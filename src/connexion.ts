// =============================================================================
// connexion.ts — Page affichée tant qu'on n'a pas saisi le mot de passe.
// =============================================================================

export const PAGE_CONNEXION = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Prospection">
<meta name="theme-color" content="#1d4ed8">
<title>Prospection permis</title>
<style>
  :root { --fond:#f4f6fb; --carte:#fff; --texte:#111827; --gris:#6b7280; --bleu:#1d4ed8; --bord:#e5e7eb; }
  @media (prefers-color-scheme: dark) {
    :root { --fond:#0f172a; --carte:#1e293b; --texte:#f1f5f9; --gris:#94a3b8; --bleu:#60a5fa; --bord:#334155; }
  }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:var(--fond); color:var(--texte); font:16px/1.4 -apple-system, system-ui, sans-serif; padding:16px; }
  form { background:var(--carte); border:1px solid var(--bord); border-radius:16px; padding:28px 22px; width:100%; max-width:360px; }
  h1 { margin:0 0 4px; font-size:22px; }
  p { margin:0 0 20px; color:var(--gris); font-size:14px; }
  input { width:100%; font-size:17px; padding:12px 14px; border-radius:10px; border:1px solid var(--bord);
          background:var(--fond); color:var(--texte); }
  button { margin-top:14px; width:100%; padding:13px; font-size:17px; font-weight:600; border:0; border-radius:10px;
           background:var(--bleu); color:#fff; }
  .erreur { color:#dc2626; font-size:14px; min-height:20px; margin-top:10px; }
</style>
</head>
<body>
<form id="f">
  <h1>🏗️ Prospection permis</h1>
  <p>Permis de construire, déclarations préalables et démolitions — 54, 55, 57, 88.</p>
  <input id="mdp" type="password" autocomplete="current-password" placeholder="Mot de passe" required autofocus>
  <button type="submit">Entrer</button>
  <div class="erreur" id="err"></div>
</form>
<script>
document.getElementById("f").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = document.getElementById("err");
  err.textContent = "";
  const r = await fetch("/api/connexion", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ motdepasse: document.getElementById("mdp").value }),
  });
  if (r.ok) location.reload();
  else err.textContent = "Mot de passe incorrect.";
});
</script>
</body>
</html>`;
