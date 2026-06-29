/**
 * Modèle de calendrier économique UNIFIÉ (format type investing.com).
 * Fusionne deux sources :
 *   - FairEconomy/ForexFactory (riche : multi-pays, heure, impact, précédent/
 *     prévision/réel) sur ~1 semaine — la base quand elle est disponible ;
 *   - FRED (US) pour PROLONGER l'horizon au-delà de la semaine FairEconomy, et
 *     comme repli total (US, sans prévision) si FairEconomy est indisponible.
 *
 * Fonctions PURES (pas d'I/O) : on leur passe les données déjà collectées.
 */

// Gabarit d'un event US issu de FRED (champs manquants = null/US par défaut).
const usEvent = (over) => ({
  time: null,
  country: "US",
  currency: "USD",
  impact: "high",
  previous: null,
  forecast: null,
  actual: null,
  surprise: null,
  ...over,
});

/** Calendrier FRED (US, sans prévision) → events unifiés (résultats + à venir). */
export function fredToEvents(fred) {
  if (!fred) return [];
  const out = [];
  for (const e of fred.recent || []) {
    if (!e.result) continue;
    out.push(
      usEvent({
        datetime: Date.parse(`${e.date}T12:00:00Z`),
        date: e.date,
        event: e.result.label,
        previous: e.result.previous ?? null,
        actual: e.result.value ?? null,
      }),
    );
  }
  for (const e of fred.upcoming || []) {
    out.push(usEvent({ datetime: Date.parse(`${e.date}T12:00:00Z`), date: e.date, event: e.name }));
  }
  return out.sort((a, b) => a.datetime - b.datetime);
}

/** Events FRED « à venir » (US) au-delà d'une date butoir — pour prolonger FairEconomy. */
export function fredUpcomingBeyond(fred, cutoffDate) {
  return (fred?.upcoming || [])
    .filter((e) => !cutoffDate || e.date > cutoffDate)
    .map((e) => usEvent({ datetime: Date.parse(`${e.date}T12:00:00Z`), date: e.date, event: e.name }));
}

/**
 * Construit la vue calendrier unifiée depuis les données FairEconomy (`ff`) et
 * FRED (`fred`). Renvoie { rich, provider, currencies, minImpact, events }.
 */
export function buildCalendar(ff, fred) {
  const ffEvents = ff?.events || [];
  const rich = ffEvents.length > 0;

  let events;
  if (rich) {
    const lastFf = ffEvents[ffEvents.length - 1]?.date;
    events = [...ffEvents, ...fredUpcomingBeyond(fred, lastFf)].sort((a, b) => a.datetime - b.datetime);
  } else {
    events = fredToEvents(fred);
  }

  return {
    rich,
    provider: rich ? "faireconomy+fred" : "fred",
    currencies: ff?.currencies ?? ["USD"],
    minImpact: ff?.minImpact ?? "high",
    events,
  };
}
