# Economic-Exposer — radar fondamental (données + IA)

Backend Node/Express : collecte ~19 sources macro/crypto, extrait des métriques,
génère des verdicts de régime (IA) et des prévisions 24h évaluées le lendemain.
Consommé par Economic-Reader (PWA) via `/api/*`.

## Lancement

- `node src/serve.mjs` — config dans `.env` (`API_PORT=3000`, clés IA, token API).
- Aucun framework de test pour l'instant : vérification = charger le module
  (`node -e "import('./src/...')"`) + appeler les routes en local.
- **`npm run lint` doit passer à 0 erreur** avant tout commit (`lint:fix` pour
  l'auto-réparable).

## Lint — gardien mécanique des conventions

- `eslint.config.js` encode les règles ci-dessous : JSDoc obligatoire partout
  (`@param`/`@returns` typés et décrits), `no-console` (sauf harnais
  `src/*.mjs`), imports triés, pas de ternaires imbriqués, pas de `var`/`==`,
  pas de réassignation d'argument.
- Hook Claude Code (`.claude/settings.json` → `scripts/lint-hook.mjs`) : après
  chaque Edit/Write d'un `.js`/`.mjs` du repo, ESLint tourne sur le fichier ;
  une violation bloque (exit 2) et le rapport revient dans la boucle de
  l'assistant, qui doit corriger avant de continuer.
- Deux règles volontairement absentes du lint (tenues en review) :
  `no-magic-numbers` (flaggerait les définitions de constantes composées type
  `30 * 60 * 1000` que la convention impose) et l'interdiction de `{*}` (types
  légitimes des parseurs tolérants).

## Architecture

- `src/modules/api/server.js` — toutes les routes REST (`/api/...`).
- `src/modules/api/auth.js` — auth par SIGNATURE HMAC par requête, AUCUN token
  en clair (en-têtes `X-Auth-Ts`/`X-Auth-Nonce`/`X-Auth-Sig`, fenêtre 90 s,
  anti-rejeu par nonce). Deux secrets : `API_FRONT_SECRET` (proxy du Reader,
  Origin contrôlé via `API_ALLOWED_ORIGINS`) et `API_ADMIN_SECRET`
  (scripts/tests, sans Origin). Pour signer en test :
  `HMAC-SHA256(secret, ts + "." + nonce + "." + méthode + "." + chemin)`.
- `src/modules/fundamental/ai/` — `analyst.js` (verdicts), `prevision.js`
  (prévisions 24h + évaluation + autopsie), `curve.js` (trajectoire, ASSETS),
  `runner.js` (orchestration/scheduling), `providers/` (DeepSeek, Groq…).
- `src/modules/fundamental/persistence/` — `store.js` (records JSON sur disque,
  un fichier par ts), `scheduler.js`, `metrics.js`.
- Les providers IA forcent `response_format: json_object` : toute réponse LLM
  doit être demandée EN JSON (voir `parseJsonLoose`).

## Conventions de code

- **Français partout** : JSDoc, logs, messages d'erreur, clés de réponse API
  (`raison`, `seuils`, `realise`…).
- **Jamais de `console.log`** : toujours le `logger` (`src/modules/logs`),
  messages préfixés `[module]`, enregistrés directement.
- **JSDoc sur CHAQUE fonction/méthode** (exportée ou privée) : rôle, `@param`,
  `@returns`. Chaque méthode doit être lisible, réutilisable et compréhensible
  seule — une responsabilité par fonction.
- **Commentaires : interdits**, à UNE exception près — détailler les propriétés
  d'une variable/objet (forme d'un record, unités, valeurs possibles).
  Ex. `const seuils = { calme: 0.35, fort: 1.42 }; // % : bornes de classe`.
  Les décisions produit datées vont dans les messages de commit et ce fichier,
  plus dans le code.
- **Lisibilité avant compacité — pas de one-liners denses.** Interdit :
  `const pct = (d) => (d && d.pct != null ? \`${d.abs >= 0 ? "+" : ""}${d.pct.toFixed(2)}%\` : "—");`
  → décomposer en variables intermédiaires au nom explicite, une opération par
  ligne, pas de ternaires imbriqués.
- **Calls API / scraping : le plus safe possible.** Timeout systématique
  (`AbortSignal.timeout`), vérification `res.ok` avant lecture, parse défensif
  (`parseJsonLoose`, try/catch), valeur de repli documentée — une source en
  panne ne fait JAMAIS tomber le service, et une donnée non validée ne se
  propage pas.
- Nommage : `camelCase`, verbe pour les fonctions (`loadPrevisionsSince`),
  `UPPER_SNAKE` pour les constantes de module, booléens en `is/has/peut`,
  unités suffixées (`timeoutMs`, `sinceTs`, `retPct`).
- ESM, imports statiques en tête. Pas de classes : fonctions + fermetures.
  Early-return. `const` par défaut, jamais `var` ni `==`.
- **Chercher l'info dans `graphify-out/` d'abord** (graphe de connaissance du
  repo : architecture, dépendances entre fichiers) avant de fouiller le code.
- Jamais d'emoji — nulle part (code, logs, API).
- **Zéro nombre magique** : toute valeur en dur devient une constante nommée
  (`EVAL_THROTTLE_MS`, `MIN_EVALS`) ; les durées s'écrivent en composées
  lisibles (`7 * 86400000` → constante `JOUR_MS` puis `7 * JOUR_MS`), jamais
  un littéral opaque type `604800000`.
- **Fonctions pures séparées des I/O** : les calculs (classification, stats,
  seuils) ne touchent ni réseau ni disque — testables isolément ; les
  fonctions d'I/O (fetch, lecture/écriture store) ne calculent pas.
- **Pas de mutation d'arguments**, sauf exception documentée dans la JSDoc
  (`@mutates record` — cas `evaluatePrevision`).
- **Retour homogène** : une fonction renvoie toujours la même forme ;
  l'alternative (`Objet|null`) est explicite dans `@returns`, jamais implicite.
- **Erreurs avec contexte** : tout log/message d'erreur porte le module et
  l'identifiant concerné (`[prevision] éval ${baseTs} : …`) — catch vide
  interdit.
- **Imports triés** : modules Node natifs d'abord, puis modules internes ;
  aucun import inutilisé.
- **Toute modification des données = deux gestes obligatoires.** Ajout/retrait
  d'une source ou d'une métrique, ou changement de source :
  1. **Fraîcheur** : mettre à jour `fundamental/freshness.js` — ajouter/retirer
     la ligne de la source dans `freshnessRows` (une source non listée = trou de
     fraîcheur silencieux ; une source retirée laissée = `null` fantôme).
  2. **Version du jeu de données** : incrémenter `DATA_PARAMS_VERSION`
     (`persistence/store.js`). Exposée en `paramsVersion` dans les réponses API
     (records stockés, `/api/health`, `/api/freshness`, index) : un consommateur
     détecte ainsi qu'un nouveau jeu de données est en ligne. Distincte de
     `SCHEMA_VERSION` (forme d'enveloppe, ne bouge que si la STRUCTURE change).

## Protocole anti-overfitting (prévisions) — RÈGLES FIGÉES

- Les règles d'évaluation (classes, seuils stockés à l'émission, exact/adjacent/
  faux) ne bougent pas pendant un rodage. On juge sur le track record complet.
- Une modification de prompt ou de calcul doit être un **défaut de démarrage
  identifié** (bug de mesure, donnée perdue), justifié par un commentaire daté —
  jamais un ajustement aux résultats de la veille.
- Les records émis ne sont JAMAIS réécrits (seuils/prédictions de l'émission
  font foi) ; l'évaluation ne fait qu'ajouter `realise`/`outcome`/`autopsie`.
- Snapshots : exception UNIQUE le 2026-10-28 (paramsVersion 4) — rattrapage
  ponctuel des snapshots pré-v3, chaque fichier modifié porte `corrections`
  (`cle`, `ancienne`, `nouvelle`, `raison`) ; les bruts d'origine (ce que l'IA
  a vu) sont dans `data/snapshots-brut-2026-10-28.tar.gz`. Verdicts et
  prévisions non touchés.
- Défauts de mesure corrigés le 2026-10-28 (audit qualité, `paramsVersion` 3) :
  `fedFunds` lit DFF (quotidien) au lieu de FEDFUNDS (moyenne mensuelle
  retardée) ; `gdeltHeadlines` agrège la salve GDELT complète (changement
  d'échelle : seuil du trigger à recalibrer après une semaine d'observation) ;
  une ligne de flux ETF supérieure à 25 % de l'encours est rejetée.

## Git / déploiement

- L'utilisateur fait tous les push/déploiements. Messages courts en français,
  préfixes `feat:` / `fix:` / `refacto:`.
- Ordre de déploiement : **Exposer d'abord, Reader ensuite** (le front dépend
  des routes).
