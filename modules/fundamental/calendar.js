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
 * Construit la vue calendrier unifiée depuis une source RICHE (`richSrc` :
 * investing.com ou FairEconomy). Renvoie
 * { rich, provider, currencies, minImpact, events }.
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
