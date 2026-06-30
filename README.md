# Crypto Fundamental Radar

Service d'**analyse fondamentale crypto** (focus Bitcoin, contexte cross-market) qui tourne en continu.

Il collecte en permanence des données réelles (sentiment, macro multi-actifs, liquidité globale, positionnement institutionnel, marchés actions, matières premières, structure crypto, on-chain, géopolitique, news), les **historise**, en calcule les **tendances** et la **normalisation** (z-score / rang percentile vs ~5 ans, pour situer chaque métrique dans sa distribution), puis les fait **synthétiser par une IA** en un verdict structuré.

> **Objectif : aide à la décision, pas un robot trader.** L'outil produit un *état du monde* + des *scénarios conditionnels* + des *alertes sur bascule* — pour que **toi** décides. Il ne prédit **pas** le prix (les marchés sont imprévisibles à court terme) ; il éclaire le contexte que tu ne peux pas surveiller 24/7 à la main.

```
collecte (17 collecteurs / 10 axes) → persistance → tendances → IA (verdict) → API
```

## Données collectées

| Axe | Sources | Clé requise |
|---|---|---|
| **sentiment** | Fear & Greed, funding/OI Binance (**BTC + ETH**), **DVOL** (vol implicite BTC, Deribit) | — |
| **positioning** | **CFTC COT multi-actifs** : net spéculatif BTC, forex (EUR/JPY/GBP), actions (S&P500/Nasdaq), or/pétrole | — |
| **macro** | FRED : M2, dollar + FX (majeures & émergents), taux (2Y→30Y, **réels**, courbe, SOFR), crédit HY, **conditions/stress (NFCI, StLouis)**, **incertitude (EPU)**, CPI/PCE/ventes/sentiment/chômage, **prix alimentaires** ; **calendrier riche multi-pays** (heure, impact, **précédent/prévision/réel** y compris **FOMC/NFP/CPI**) scrapé sur **investing.com** (repli FairEconomy) | `FRED_API_KEY` ; investing.com/FairEconomy *(sans clé)* |
| **liquidity** | Liquidité nette Fed (bilan − RRP − TGA) **+ liquidité GLOBALE (Fed + BCE + BoJ)** (FRED) — *driver clé* | `FRED_API_KEY` |
| **commodities** | WTI, Brent, gaz, cuivre, blé (FRED) + **or, argent** (gold-api) | `FRED_API_KEY` |
| **markets** | S&P500, Nasdaq, Dow, VIX en clôture J-1 (FRED) + **intraday temps réel** (Finnhub ou Twelve Data) | `FRED_API_KEY` ; `FINNHUB_API_KEY` *(optionnel, intraday)* |
| **structure** | dominance BTC/ETH, ETH/BTC, mcap total + **TOTAL2/TOTAL3** (force des alts) (CoinGecko) | `COINGECKO_API_KEY` *(optionnel)* |
| **onchain** | TVL, stablecoins (DefiLlama), hashrate (blockchain.info) | — |
| **geopolitics** | manchettes (GDELT), conflits structurés (ACLED) | ACLED *(optionnel)* |
| **news** | 22 flux RSS + 9 thèmes Google News | — |

## Installation

Node 18+ requis.

```bash
npm install
cp .env.exemple .env   # puis renseigne les clés
```

Clés (toutes gratuites) : `FRED_API_KEY` ([fred](https://fredaccount.stlouisfed.org/apikeys)), `DEEPSEEK_API_KEY` ([deepseek](https://platform.deepseek.com)), `GROQ_API_KEY` ([groq](https://console.groq.com/keys)). Optionnelles : `COINGECKO_API_KEY`, `ACLED_EMAIL`/`ACLED_PASSWORD`.
Chaque source absente dégrade proprement (marquée `stale`), sans casser le reste.

## Commandes

Chaque commande `fa:<x>` correspond au fichier d'entrée `<x>.mjs` à la racine.

| Commande | Rôle | Écrit dans `data/` |
|---|---|---|
| `npm run fa:check` | Photo live des 10 axes + dump complet inspectable | `last-check.json` (dump debug) |
| `npm run fa:freshness` | Diagnostic de fraîcheur : date réelle + âge de chaque source | — (lecture seule) |
| `npm run fa:api` | **API HTTP publique** seule (port 3000, lecture) | — (lecture seule) |
| `npm run fa:trends` | Collecte 1 snapshot + affiche les tendances (1h/24h/7j) | **snapshot** |
| `npm run fa:ai` | **Force** une analyse IA → **JSON pur** sur stdout (`--prompt` = debug, n'écrit rien) | **snapshot + verdict** |
| `npm run fa:tick` | Un tour de service (collecte + analyse *conditionnelle*) | **snapshot** (+ verdict si déclenché) |
| `npm run fa:serve` | **Service 24/7 « lance et oublie »** : collecte horaire + IA (fond + bascule) + **webhook** + **API** dans un seul process | **snapshots + verdicts** |

Trois familles : **diagnostic** (lecture seule : `check`, `freshness`, `api`) · **génération de données** (historisent : `trends`, `ai`, `tick`, `serve`). Pour un déploiement headless, `fa:serve` suffit (il sert aussi l'API).

### Logique du service (`fa:serve`)

Collecte **chaque heure**. L'IA ne se déclenche **que** si : la cadence de fond (`AI_BASELINE_HOURS`, défaut 4h) est dépassée, **OU** une bascule notable est détectée (seuils : F&G ±6, DXY ±0.5 %, S&P ±1 %, VIX ±10 %, BTC ±3 %…), **OU** un catalyseur calendaire tombe le jour même (CPI, NFP, **FOMC**…). → pas de spam, pas de coût inutile.

### IA — fournisseurs

`LLM_PROVIDER` (défaut `deepseek`) choisit le principal ; **fallback automatique vers Groq** si le principal échoue. Disponibles : `deepseek`, `groq`, `gemini` *(palier gratuit indisponible en UE)*.

Le verdict est un JSON structuré : `resume`, `regime`, `confiance`, `niveau_de_risque`, `lecture_par_axe`, `signaux_cles`, `ce_qui_a_change`, `correlations` (cross-market), `scenarios`, `catalyseurs_a_venir`, `asymetrie`, **`horizon`** (échelle de temps de validité, swing) + **`invalidation`** (ce qui annulerait la lecture), `alertes`, **`pour_debutants`** (vulgarisation + **posture** défensif/neutre/opportuniste-prudent + **à éviter** + termes clés ; pas de daytrading), **`conseils`** (2-3 conseils prudents — pas de reco financière). Les `signaux_cles` portent le **percentile** (ex. `p53/5a`). Le *record* de verdict porte aussi `schemaVersion`, `triggers` et **`dataQuality`** (sources `stale` au moment de l'analyse).

## Webhook (sortie push)

Le service est headless : il **pousse** chaque verdict (en marche normale) vers `WEBHOOK_URL` par un simple POST JSON — n'importe quel consommateur peut capter (bot, n8n, Zapier, backend…). Pas de Telegram, pas d'UI. Si `WEBHOOK_SECRET` est défini, le corps est signé en HMAC-SHA256 (`X-Signature-256: sha256=<hex>`). Le payload contient un résumé en tête (`regime`, `niveau_de_risque`, `confiance`, `resume`, `horizon`, `posture`, `triggers`, `alertes`, `dataQuality`) **+** le verdict complet.

## API (lecture seule, CORS ouvert)

Base : `http://localhost:3000`. Auth optionnelle via `API_TOKEN` (Bearer), rate-limit optionnel via `API_RATE_LIMIT` — utiles si l'API est exposée hors localhost.

| Endpoint | Description |
|---|---|
| `GET /api/health` | Statut + `schemaVersion` |
| `GET /api` | Index des endpoints |
| `GET /api/snapshots?since=&limit=` | Liste des snapshots (`{ts, iso}`) |
| `GET /api/snapshots/latest` | Dernier snapshot complet |
| `GET /api/snapshots/:ts` | Un snapshot (ts en epoch ms ou ISO) |
| `GET /api/snapshots/:ts/verdict` | **Le verdict produit à partir de ce snapshot** |
| `GET /api/verdicts?since=&limit=` | Liste des verdicts |
| `GET /api/verdicts/latest` | Dernier verdict |
| `GET /api/verdicts/:ts` | Un verdict |
| `GET /api/verdicts/:ts/snapshot` | **Le snapshot qui a produit ce verdict** |
| `GET /api/verdicts/:ts/outcome` | **Suivi a posteriori** : deltas factuels des métriques-clés à +24h/+7j |
| `GET /api/trends?lookbackDays=` | Tendances (deltas 1h/24h/7j) **+ normalisation** (`z`, `pctRank` vs ~5 ans) |
| `GET /api/metrics?since=` | Série de métriques (pour graphes) |
| `GET /api/dictionary` | **Dictionnaire** des métriques (label, unité, axe, source, **sens**) — API auto-descriptive |
| `GET /api/glossary` | **Glossaire** des termes clés (pour consommateur néophyte) |
| `GET /api/calendar` | **Calendrier éco unifié** (format investing.com) : investing.com (multi-pays, heure, impact, précédent/prévision/**réel**), repli FairEconomy |

## Stockage des données

```
data/
  snapshots/AAAA-MM-JJ/<ISO-ts>.json   # 1 fichier/collecte : état complet (10 axes) + ~60 métriques fusionnés
  verdicts/AAAA-MM-JJ/<ISO-ts>.json    # 1 fichier/analyse IA
  ai-state.json                        # référence de bascule + dernier run IA
  last-check.json                      # dernier dump de fa:check
```

**Corrélation snapshot ↔ verdict** : un snapshot et le verdict qui en découle partagent le **même `ts`** (même fichier-horodatage). On retrouve donc l'un depuis l'autre directement (cf. endpoints `/verdict` et `/snapshot`).

## Statut

Service complet et headless : collecte → persistance → tendances → IA → API + **webhook**. Conçu comme un service de données pur (pas d'UI) : un consommateur externe lit l'API (auto-descriptive via `/api/dictionary` & `/api/glossary`) ou reçoit le push webhook.
