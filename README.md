# Crypto Fundamental Radar

Service d'**analyse fondamentale crypto** (focus Bitcoin, contexte cross-market) qui tourne en continu.

Il collecte en permanence des données réelles (sentiment, macro, marchés actions, matières premières, structure crypto, on-chain, géopolitique, news), les **historise**, en calcule les **tendances**, puis les fait **synthétiser par une IA** en un verdict structuré.

> **Objectif : aide à la décision, pas un robot trader.** L'outil produit un *état du monde* + des *scénarios conditionnels* + des *alertes sur bascule* — pour que **toi** décides. Il ne prédit **pas** le prix (les marchés sont imprévisibles à court terme) ; il éclaire le contexte que tu ne peux pas surveiller 24/7 à la main.

```
collecte (17 collecteurs / 10 axes) → persistance → tendances → IA (verdict) → API
```

## Données collectées

| Axe | Sources | Clé requise |
|---|---|---|
| **sentiment** | Fear & Greed, funding/OI Binance, **DVOL** (vol implicite BTC, Deribit) | — |
| **positioning** | **CFTC COT** : positionnement futures BTC CME (hedge funds vs institutionnels) | — |
| **macro** | FRED : M2, dollar + FX (majeures & émergents), taux (2Y→30Y, **réels**, courbe, SOFR), crédit HY, **conditions/stress (NFCI, StLouis)**, **incertitude (EPU)**, CPI/PCE/ventes/sentiment/chômage, **prix alimentaires** + calendrier éco (publications US **+ réunions FOMC** + **résultats publiés**) ; **calendrier riche multi-pays** (heure, impact, **précédent/prévision/réel**) via FairEconomy/ForexFactory | `FRED_API_KEY` ; FairEconomy *(sans clé)* |
| **liquidity** | Liquidité nette = bilan Fed − RRP − TGA (FRED) — *driver clé* | `FRED_API_KEY` |
| **commodities** | WTI, Brent, gaz, cuivre, blé (FRED) + **or, argent** (gold-api) | `FRED_API_KEY` |
| **markets** | S&P500, Nasdaq, Dow, VIX en clôture J-1 (FRED) + **intraday temps réel** (Finnhub ou Twelve Data) | `FRED_API_KEY` ; `FINNHUB_API_KEY` *(optionnel, intraday)* |
| **structure** | dominance BTC, ETH/BTC, mcap (CoinGecko) | `COINGECKO_API_KEY` *(optionnel)* |
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
| `npm run fa:api` | **API HTTP publique** (port 3000) + page calendrier | — (lecture seule) |
| `npm run fa:trends` | Collecte 1 snapshot + affiche les tendances (1h/24h/7j) | **snapshot** |
| `npm run fa:ai` | **Force** une analyse IA → **JSON pur** sur stdout (`--prompt` = debug, n'écrit rien) | **snapshot + verdict** |
| `npm run fa:tick` | Un tour de service (collecte + analyse *conditionnelle*) | **snapshot** (+ verdict si déclenché) |
| `npm run fa:serve` | **Service 24/7** : collecte horaire + IA (fond + bascule) | **snapshots + verdicts** |

Trois familles : **diagnostic** (lecture seule : `check`, `freshness`, `api`) · **génération de données** (historisent : `trends`, `ai`, `tick`, `serve`).

### Logique du service (`fa:serve`)

Collecte **chaque heure**. L'IA ne se déclenche **que** si : la cadence de fond (`AI_BASELINE_HOURS`, défaut 4h) est dépassée, **OU** une bascule notable est détectée (seuils : F&G ±6, DXY ±0.5 %, S&P ±1 %, VIX ±10 %, BTC ±3 %…), **OU** un catalyseur calendaire tombe le jour même (CPI, NFP, **FOMC**…). → pas de spam, pas de coût inutile.

### IA — fournisseurs

`LLM_PROVIDER` (défaut `deepseek`) choisit le principal ; **fallback automatique vers Groq** si le principal échoue. Disponibles : `deepseek`, `groq`, `gemini` *(palier gratuit indisponible en UE)*.

Le verdict est un JSON structuré : `resume`, `regime`, `confiance`, `niveau_de_risque`, `lecture_par_axe`, `signaux_cles`, `ce_qui_a_change`, `correlations` (cross-market), `scenarios`, `catalyseurs_a_venir`, `asymetrie`, `alertes`, **`pour_debutants`** (vulgarisation + termes clés), **`conseils`** (2-3 conseils prudents adaptés au régime, orientés gestion du risque — pas de reco financière).

## Interface web

`npm run fa:api` sert aussi une **page calendrier** (façon investing.com) sur `http://localhost:3000/` : tableau multi-pays avec heure, impact, précédent/prévision/réel, filtres (impact, pays, à venir/publiés) et rafraîchissement auto.

## API (lecture seule, CORS ouvert)

Base : `http://localhost:3000`

| Endpoint | Description |
|---|---|
| `GET /api/health` | Statut |
| `GET /api/snapshots?since=&limit=` | Liste des snapshots (`{ts, iso}`) |
| `GET /api/snapshots/latest` | Dernier snapshot complet |
| `GET /api/snapshots/:ts` | Un snapshot (ts en epoch ms ou ISO) |
| `GET /api/snapshots/:ts/verdict` | **Le verdict produit à partir de ce snapshot** |
| `GET /api/verdicts?since=&limit=` | Liste des verdicts |
| `GET /api/verdicts/latest` | Dernier verdict |
| `GET /api/verdicts/:ts` | Un verdict |
| `GET /api/verdicts/:ts/snapshot` | **Le snapshot qui a produit ce verdict** |
| `GET /api/trends?lookbackDays=` | Tendances courantes |
| `GET /api/metrics?since=` | Série de métriques (pour graphes) |
| `GET /api/calendar` | **Calendrier éco unifié** (format investing.com) : FairEconomy (multi-pays, heure, impact, précédent/prévision/réel, ~7 j) + FRED (horizon US lointain + FOMC) |

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

Socle complet et fonctionnel : collecte → persistance → tendances → IA → API.
À venir : alertes Telegram (push du verdict sur bascule), dashboard.
