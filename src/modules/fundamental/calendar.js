/**
 * Modèle de calendrier économique UNIFIÉ (format type investing.com).
 *
 * Source RICHE unique (multi-pays, heure, impact, précédent/prévision/réel) :
 * API nasdaq en primaire, FairEconomy/ForexFactory en repli — toutes deux
 * produisent la même forme d'event. La fusion des deux (ou le chevauchement des
 * fenêtres de jours nasdaq) peut créer des DOUBLONS : on les retire ici.
 *
 * Fonction PURE (pas d'I/O) : on lui passe les données déjà collectées.
 */

/**
 * Clé d'unicité d'un événement calendaire : même horaire + même devise/pays +
 * même intitulé = même événement, quelle que soit la source.
 * @param {object} event Événement ({ datetime, currency, country, event }).
 * @returns {string} Clé de déduplication.
 */
function eventKey(event) {
  const quand = event.datetime ?? event.date ?? "";
  const zone = (event.currency || event.country || "").toLowerCase();
  const intitule = (event.event || "").trim().toLowerCase();
  return `${quand}|${zone}|${intitule}`;
}

/**
 * Construit la vue calendrier unifiée depuis une source RICHE (nasdaq ou
 * FairEconomy) : doublons retirés, events triés chronologiquement.
 * @param {object|null} richSrc Données du collecteur calendrier
 *   ({ source, currencies, minImpact, events }).
 * @returns {{rich: boolean, provider: string, currencies: Array<string>,
 *   minImpact: string, events: Array<object>}} Vue unifiée (provider "none"
 *   et events vides si la source n'a rien fourni).
 */
export function buildCalendar(richSrc) {
  const seen = new Set();
  const uniques = [];
  for (const event of richSrc?.events ?? []) {
    const key = eventKey(event);
    if (seen.has(key)) continue;
    seen.add(key);
    uniques.push(event);
  }
  const events = uniques.sort((a, b) => a.datetime - b.datetime);
  const rich = events.length > 0;

  return {
    rich,
    provider: rich ? richSrc.source || "rich" : "none",
    currencies: richSrc?.currencies ?? ["USD"],
    minImpact: richSrc?.minImpact ?? "high",
    events,
  };
}
