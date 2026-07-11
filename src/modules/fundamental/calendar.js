/**
 * Modèle de calendrier économique UNIFIÉ (format type investing.com).
 *
 * Source RICHE unique (multi-pays, heure, impact, précédent/prévision/réel) :
 * investing.com en primaire, FairEconomy/ForexFactory en repli — toutes deux
 * produisent la même forme d'event.
 *
 * Fonction PURE (pas d'I/O) : on lui passe les données déjà collectées.
 */

/**
 * Construit la vue calendrier unifiée depuis une source RICHE (investing.com
 * ou FairEconomy), events triés chronologiquement.
 * @param {object|null} richSrc Données du collecteur calendrier
 *   ({ source, currencies, minImpact, events }).
 * @returns {{rich: boolean, provider: string, currencies: Array<string>,
 *   minImpact: string, events: Array<object>}} Vue unifiée (provider "none"
 *   et events vides si la source n'a rien fourni).
 */
export function buildCalendar(richSrc) {
  const events = (richSrc?.events || []).slice().sort((a, b) => a.datetime - b.datetime);
  const rich = events.length > 0;

  return {
    rich,
    provider: rich ? richSrc.source || "rich" : "none",
    currencies: richSrc?.currencies ?? ["USD"],
    minImpact: richSrc?.minImpact ?? "high",
    events,
  };
}
