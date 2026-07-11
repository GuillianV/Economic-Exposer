import { Collector } from "./base.js";

/**
 * ACLED — Armed Conflict Location & Event Data.
 * Le standard des événements de conflit armé (lieu, type, acteurs, morts).
 * Données STRUCTURÉES (vs simples manchettes) → on quantifie l'intensité.
 * Axe : geopolitics.
 *
 * Accès (gratuit, non-commercial) : compte myACLED + OAuth (plus de clé API).
 * Identifiants dans .env : ACLED_EMAIL / ACLED_PASSWORD — absents, le
 * collecteur throw → "stale" dans le world-state.
 * Flux : POST /oauth/token (password grant) → access_token (24h) →
 * GET /api/acled/read avec Authorization: Bearer <token>.
 */
const TOKEN_URL = "https://acleddata.com/oauth/token";
const READ_URL = "https://acleddata.com/api/acled/read";
const READ_TIMEOUT_MS = 20000;
const DAY_MS = 86400000;
const TOKEN_DEFAULT_TTL_S = 86400; // durée de vie du token si l'API ne la donne pas
const TOKEN_SAFETY_MARGIN_S = 60; // renouvelé un peu avant l'expiration réelle

export class AcledCollector extends Collector {
  /**
   * @param {{ windowDays?: number, limit?: number, topCountries?: number,
   *   recentEvents?: number }} [options] Fenêtre d'analyse, plafond
   *   d'événements demandés, tailles des tops renvoyés.
   */
  constructor({ windowDays = 7, limit = 1000, topCountries = 8, recentEvents = 12 } = {}) {
    super("acled", { axis: "geopolitics" });
    this.windowDays = windowDays;
    this.limit = limit;
    this.topCountries = topCountries;
    this.recentEvents = recentEvents;
    this._token = null; // access_token OAuth en cours
    this._tokenExp = 0; // expiration du token (ms epoch)
  }

  /**
   * Access token OAuth (password grant), réutilisé jusqu'à expiration.
   * @param {string} email Identifiant myACLED.
   * @param {string} password Mot de passe myACLED.
   * @returns {Promise<string>} Access token valide.
   * @throws {Error} Statut HTTP non-2xx ou token absent de la réponse.
   */
  async #getToken(email, password) {
    if (this._token && Date.now() < this._tokenExp) return this._token;

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
    const ttlSeconds = (json.expires_in || TOKEN_DEFAULT_TTL_S) - TOKEN_SAFETY_MARGIN_S;
    this._tokenExp = Date.now() + ttlSeconds * 1000;
    return this._token;
  }

  /**
   * Événements de conflit sur la fenêtre récente : totaux, intensité par pays
   * (top) et événements les plus récents/meurtriers.
   * @returns {Promise<{windowDays: number, totalEvents: number,
   *   totalFatalities: number, topCountries: Array<object>,
   *   recentEvents: Array<object>}>} Synthèse quantifiée des conflits.
   * @throws {Error} Identifiants absents, OAuth ou lecture en échec.
   */
  async fetchData() {
    const email = process.env.ACLED_EMAIL;
    const password = process.env.ACLED_PASSWORD;
    if (!email || !password) throw new Error("ACLED_EMAIL / ACLED_PASSWORD absents du .env");

    const token = await this.#getToken(email, password);

    const today = new Date().toISOString().slice(0, 10);
    const since = new Date(Date.now() - this.windowDays * DAY_MS).toISOString().slice(0, 10);
    const fields = "event_date|event_type|sub_event_type|country|region|actor1|actor2|fatalities|notes";
    const url =
      `${READ_URL}?_format=json` +
      `&event_date=${since}|${today}&event_date_where=BETWEEN` +
      `&fields=${encodeURIComponent(fields)}&limit=${this.limit}`;

    const json = await this.getJson(url, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: READ_TIMEOUT_MS,
    });
    if (json && json.success === false) {
      throw new Error(`ACLED erreur : ${json.error?.[0]?.message || JSON.stringify(json.error) || "non-success"}`);
    }

    const events = Array.isArray(json?.data) ? json.data : [];
    let totalFatalities = 0;
    const byCountry = new Map(); // pays -> { country, events, fatalities }

    const normalized = events.map((event) => {
      const fatalities = Number(event.fatalities) || 0;
      totalFatalities += fatalities;

      const countryStats = byCountry.get(event.country) || { country: event.country, events: 0, fatalities: 0 };
      countryStats.events += 1;
      countryStats.fatalities += fatalities;
      byCountry.set(event.country, countryStats);

      return {
        date: event.event_date,
        country: event.country,
        region: event.region,
        eventType: event.event_type,
        subEventType: event.sub_event_type,
        actors: [event.actor1, event.actor2].filter(Boolean).join(" vs "),
        fatalities,
        notes: (event.notes || "").slice(0, 240),
      };
    });

    const topCountries = [...byCountry.values()]
      .sort((a, b) => b.fatalities - a.fatalities || b.events - a.events)
      .slice(0, this.topCountries);

    const recentEvents = normalized
      .slice()
      .sort((a, b) => {
        if (a.date < b.date) return 1;
        if (a.date > b.date) return -1;
        return b.fatalities - a.fatalities;
      })
      .slice(0, this.recentEvents);

    return {
      windowDays: this.windowDays,
      totalEvents: normalized.length,
      totalFatalities,
      topCountries,
      recentEvents,
    };
  }
}
