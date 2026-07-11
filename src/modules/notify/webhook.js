import crypto from "node:crypto";
import { logger } from "../logs/index.js";

/**
 * Émetteur de WEBHOOK — la seule SORTIE "push" du service. Quand l'IA produit
 * un verdict (sur déclenchement réel du service), on POST un payload JSON vers
 * `WEBHOOK_URL` pour que N'IMPORTE QUEL consommateur (bot, front, n8n, Zapier…)
 * réagisse. Pas de dépendance, pas de Telegram : un simple POST HTTP.
 *
 * Config (.env) :
 *   WEBHOOK_URL     — destination du POST (si absent : no-op silencieux).
 *   WEBHOOK_SECRET  — si présent, signe le corps en HMAC-SHA256 et l'envoie dans
 *                     l'entête `X-Signature-256: sha256=<hex>` (le consommateur
 *                     peut vérifier l'authenticité).
 *   WEBHOOK_TIMEOUT_MS — timeout du POST (défaut 10 000).
 *
 * TOLÉRANT : un échec d'envoi est loggé en warn et ne casse JAMAIS la boucle.
 */
const DEFAULT_TIMEOUT_MS = 10000;

/**
 * POST le payload d'un événement vers WEBHOOK_URL (signé si WEBHOOK_SECRET).
 * @param {object} event Payload sérialisable (doit porter `type`).
 * @returns {Promise<{sent: boolean, reason?: string}>} Résultat d'envoi —
 *   jamais de throw.
 */
export async function emitWebhook(event) {
  const url = process.env.WEBHOOK_URL;
  if (!url) return { sent: false, reason: "WEBHOOK_URL absent (push désactivé)" };

  const body = JSON.stringify(event);
  const headers = { "Content-Type": "application/json", "User-Agent": "crypto-fundamental-radar" };
  const secret = process.env.WEBHOOK_SECRET;
  if (secret) {
    const signature = crypto.createHmac("sha256", secret).update(body).digest("hex");
    headers["X-Signature-256"] = `sha256=${signature}`;
  }

  const timeoutMs = Number(process.env.WEBHOOK_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "POST", headers, body, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    logger.info(`[webhook] ${event.type} envoyé → ${url}`);
    return { sent: true };
  } catch (err) {
    logger.warn(`[webhook] échec d'envoi (${event.type}) : ${err.message}`);
    return { sent: false, reason: err.message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * URL canonique de la ressource pour le consommateur. Préfixe `API_PUBLIC_URL`
 * (ex. https://macro-api.guillian.net) si défini, sinon chemin relatif.
 * @param {string} pathname Chemin de la ressource (ex. /api/verdicts/123).
 * @returns {string} URL absolue ou chemin relatif.
 */
function resourceUrl(pathname) {
  const base = process.env.API_PUBLIC_URL;
  return base ? base.replace(/\/$/, "") + pathname : pathname;
}

/**
 * Construit le payload webhook à partir d'un record de verdict. Auto-suffisant :
 * un résumé en tête (régime/risque/confiance/résumé/déclencheurs/fraîcheur) +
 * le verdict complet, pour que le consommateur n'ait pas à rappeler l'API.
 * @param {object} record Record de verdict persisté ({ ts, verdict, triggers,
 *   dataQuality… }).
 * @returns {object} Payload webhook (`type` discrimine, `url` pointe la
 *   ressource).
 */
export function verdictEvent(record) {
  const v = record.verdict || {};
  return {
    type: "verdict",
    url: resourceUrl(`/api/verdicts/${record.ts}`),
    ts: record.ts,
    iso: new Date(record.ts).toISOString(),
    schemaVersion: record.schemaVersion ?? null,
    regime: v.regime ?? null,
    niveau_de_risque: v.niveau_de_risque ?? null,
    confiance: v.confiance ?? null,
    resume: v.resume ?? null,
    horizon: v.horizon ?? null,
    posture: v.pour_debutants?.posture ?? null,
    triggers: record.triggers ?? [],
    alertes: v.alertes ?? [],
    dataQuality: record.dataQuality ?? null,
    verdict: v,
  };
}
