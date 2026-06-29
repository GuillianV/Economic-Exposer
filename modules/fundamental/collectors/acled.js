import { Collector } from "./base.js";

/**
 * ACLED — Armed Conflict Location & Event Data.
 * Le standard des événements de conflit armé (lieu, type, acteurs, morts).
 * Données STRUCTURÉES (vs simples manchettes) → on quantifie l'intensité.
 *
 * Accès (gratuit, non-commercial) : ACLED n'utilise PLUS de clé API mais un
 * compte myACLED + OAuth. Crée un compte sur https://acleddata.com/register
 * puis mets tes identifiants dans .env :
 *   ACLED_EMAIL=...     ACLED_PASSWORD=...
 * Sans identifiants, le collecteur throw -> "stale" dans le world-state.
 *
 * Flux : POST /oauth/token (password grant) -> access_token (24h) ->
 *        GET /api/acled/read avec header Authorization: Bearer <token>.
 *
 * Axe : geopolitics. Donne, sur une fenêtre récente : nb événements + morts,
 * intensité par pays (top), événements récents.
 */
const TOKEN_URL = "https://acleddata.com/oauth/token";
const READ_URL = "https://acleddata.com/api/acled/read";

export class AcledCollector extends Collector {
  constructor({ windowDays = 7, limit = 1000, topCountries = 8, recentEvents = 12 } = {}) {
    super("acled", { axis: "geopolitics" });
    this.windowDays = windowDays;
    this.limit = limit;
    this.topCountries = topCountries;
    this.recentEvents = recentEvents;
    this._token = null;
    this._tokenExp = 0; // ms epoch
  }

  async #getToken(email, password) {
    if (this._token && Date.now() < this._tokenExp) return this._token; // réutilise (24h)

    const body = new URLSearchParams({
      username: email,
      password,
      grant_type: "password",
      client_id: "acled",
      scope: "authenticated",
    });
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) throw new Error(`OAuth ACLED HTTP ${res.status}`);
    const json = await res.json();
    if (!json.access_token) throw new Error("OAuth ACLED : access_token manquant");
    this._token = json.access_token;
    this._tokenExp = Date.now() + ((json.expires_in || 86400) - 60) * 1000;
    return this._token;
  }

  async fetchData() {
    const email = process.env.ACLED_EMAIL;
    const password = process.env.ACLED_PASSWORD;
    if (!email || !password) throw new Error("ACLED_EMAIL / ACLED_PASSWORD absents du .env");

    const token = await this.#getToken(email, password);

    const today = new Date().toISOString().slice(0, 10);
    const since = new Date(Date.now() - this.windowDays * 86400000).toISOString().slice(0, 10);
    const fields = "event_date|event_type|sub_event_type|country|region|actor1|actor2|fatalities|notes";
    const url =
      `${READ_URL}?_format=json` +
      `&event_date=${since}|${today}&event_date_where=BETWEEN` +
      `&fields=${encodeURIComponent(fields)}&limit=${this.limit}`;

    const json = await this.getJson(url, { headers: { Authorization: `Bearer ${token}` }, timeout: 20000 });
    if (json && json.success === false) {
      throw new Error(`ACLED erreur : ${json.error?.[0]?.message || JSON.stringify(json.error) || "non-success"}`);
    }
    const events = Array.isArray(json?.data) ? json.data : [];

    let totalFatalities = 0;
    const byCountry = new Map();
    const normalized = events.map((e) => {
      const fatalities = Number(e.fatalities) || 0;
      totalFatalities += fatalities;
      const acc = byCountry.get(e.country) || { country: e.country, events: 0, fatalities: 0 };
      acc.events += 1;
      acc.fatalities += fatalities;
      byCountry.set(e.country, acc);
      return {
        date: e.event_date,
        country: e.country,
        region: e.region,
        eventType: e.event_type,
        subEventType: e.sub_event_type,
        actors: [e.actor1, e.actor2].filter(Boolean).join(" vs "),
        fatalities,
        notes: (e.notes || "").slice(0, 240),
      };
    });

    const topCountries = [...byCountry.values()]
      .sort((a, b) => b.fatalities - a.fatalities || b.events - a.events)
      .slice(0, this.topCountries);

    const recent = normalized
      .slice()
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.fatalities - a.fatalities))
      .slice(0, this.recentEvents);

    return {
      windowDays: this.windowDays,
      totalEvents: normalized.length,
      totalFatalities,
      topCountries,
      recentEvents: recent,
    };
  }
}
