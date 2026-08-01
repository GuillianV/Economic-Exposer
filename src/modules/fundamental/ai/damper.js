/**
 * Amortisseur anti-girouette GÉNÉRIQUE (pur). Une valeur discrète brute
 * différente de la dernière valeur confirmée n'est adoptée qu'après `cycles`
 * observations concordantes ; entre-temps la valeur confirmée est tenue et la
 * valeur pressentie mémorisée. Partagé par le régime du verdict (runner.js) et
 * la zone de la boussole (regime.js) : une seule sémantique, un seul seuil.
 */

// Observations concordantes requises avant d'adopter une bascule (le brut peut
// osciller au boundary d'un seuil).
export const CONFIRM_CYCLES = 2;

/**
 * Applique l'amortisseur à une observation brute.
 * @param {string} brut Valeur discrète de l'observation courante.
 * @param {{confirmee: string|null|undefined, pressenti: string|null,
 *   compteur: number}} etatPrec État précédent (valeur confirmée publiée,
 *   valeur pressentie, compteur de concordance).
 * @param {number} [cycles] Observations concordantes requises pour basculer.
 * @returns {{valeur: string, pressenti: string|null, compteur: number,
 *   tenue: boolean}} Valeur à publier + état à persister ; `tenue` vrai si on
 *   conserve la valeur précédente en attendant confirmation.
 */
export function amortirBascule(brut, etatPrec, cycles = CONFIRM_CYCLES) {
  const confirmeePrec = etatPrec.confirmee ?? brut;
  if (brut === confirmeePrec) {
    return { valeur: brut, pressenti: null, compteur: 0, tenue: false };
  }
  const compteur = brut === etatPrec.pressenti ? etatPrec.compteur + 1 : 1;
  if (compteur >= cycles) {
    return { valeur: brut, pressenti: null, compteur: 0, tenue: false };
  }
  return { valeur: confirmeePrec, pressenti: brut, compteur, tenue: true };
}
