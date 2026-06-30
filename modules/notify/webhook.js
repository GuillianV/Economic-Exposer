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
export async function emitWebhook(event) {
  const url = process.env.WEBHOOK_URL;
  if (!url) return { sent: false, reason: "WEBHOOK_URL absent (push désactivé)" };

  const body = JSON.stringify(event);
  const headers = { "Content-Type": "application/json", "User-Agent": "crypto-fundamental-radar" };
  const secret = process.env.WEBHOOK_SECRET;
  if (secret) {
    const sig = crypto.createHmac("sha256", secret).update(body).digest("hex");
    headers["X-Signature-256"] = `sha256=${sig}`;
  }

  const timeout = Number(process.env.WEBHOOK_TIMEOUT_MS) || 10000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
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
 * Construit le payload webhook à partir d'un record de verdict. Auto-suffisant :
 * un résumé en tête (régime/risque/confiance/résumé/déclencheurs/fraîcheur) +
 * le verdict complet, pour que le consommateur n'ait pas à rappeler l'API.
 */
export function verdictEvent(record) {
  const v = record.verdict || {};
  return {
    type: "verdict",
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
