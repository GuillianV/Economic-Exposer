import crypto from "node:crypto";
import { logger } from "../logs/index.js";

/**
 * Authentification par SIGNATURE HMAC par requête — remplace le Bearer token.
 *
 * Le client envoie trois en-têtes :
 *   X-Auth-Ts    — epoch ms d'émission de la requête
 *   X-Auth-Nonce — aléa unique par requête (anti-rejeu)
 *   X-Auth-Sig   — HMAC-SHA256(secret, `${ts}.${nonce}.${méthode}.${chemin}`)
 *
 * Deux secrets, deux usages :
 *   API_FRONT_SECRET — détenu par le PROXY du Reader (jamais dans le
 *     navigateur) ; si la requête porte un en-tête Origin, il doit appartenir
 *     à API_ALLOWED_ORIGINS.
 *   API_ADMIN_SECRET — scripts/tests directs (local ou prod), sans contrainte
 *     d'Origin.
 *
 * Anti-rejeu : fenêtre temporelle serrée + registre mémoire des nonces déjà
 * vus (purgé). Un ID capturé est inutilisable : expiré hors fenêtre, rejeté
 * si rejoué dans la fenêtre. Aucun token en clair n'est accepté.
 */
const SIGNATURE_WINDOW_MS = 90000;
const NONCE_TTL_MS = 2 * SIGNATURE_WINDOW_MS;
const NONCE_PURGE_INTERVAL_MS = 60000;

const seenNonces = new Map(); // nonce -> expiration (epoch ms)
let lastPurgeTs = 0; // dernière purge du registre (epoch ms)

/**
 * Purge les nonces expirés du registre, au plus une fois par intervalle.
 * @param {number} now Epoch ms courant.
 * @returns {void}
 */
function purgeExpiredNonces(now) {
  if (now - lastPurgeTs < NONCE_PURGE_INTERVAL_MS) return;
  lastPurgeTs = now;
  for (const [nonce, expiry] of seenNonces) {
    if (expiry <= now) seenNonces.delete(nonce);
  }
}

/**
 * Signature HMAC-SHA256 attendue pour une requête.
 * @param {string} secret Secret partagé.
 * @param {string} ts Timestamp d'émission (epoch ms, chaîne).
 * @param {string} nonce Aléa unique de la requête.
 * @param {string} method Méthode HTTP (GET, POST…).
 * @param {string} pathName Chemin signé (ex. /api/trends, sans query).
 * @returns {string} Signature hexadécimale.
 */
function computeSignature(secret, ts, nonce, method, pathName) {
  const payload = `${ts}.${nonce}.${method}.${pathName}`;
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Comparaison de chaînes en temps constant (anti timing attack).
 * @param {string} a Première chaîne.
 * @param {string} b Seconde chaîne.
 * @returns {boolean} true si identiques.
 */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Vérifie la signature d'une requête contre un secret donné.
 * @param {string} secret Secret candidat.
 * @param {object} req Requête Express.
 * @param {{ts: string, nonce: string, sig: string}} auth En-têtes d'auth extraits.
 * @returns {boolean} true si la signature correspond.
 */
function matchesSecret(secret, req, auth) {
  if (!secret) return false;
  const expected = computeSignature(secret, auth.ts, auth.nonce, req.method, req.path);
  return safeEqual(expected, auth.sig);
}

/**
 * Teste l'appartenance d'un Origin à la liste autorisée.
 * @param {string} origin Valeur de l'en-tête Origin.
 * @param {Set<string>} allowedOrigins Origins autorisés (normalisés sans / final).
 * @returns {boolean} true si autorisé.
 */
function isOriginAllowed(origin, allowedOrigins) {
  const normalized = String(origin).replace(/\/$/, "").toLowerCase();
  return allowedOrigins.has(normalized);
}

/**
 * Construit le middleware d'auth : signature HMAC exigée partout (admin, ou
 * front avec contrôle d'Origin). Si aucun secret n'est configuré, l'API reste
 * ouverte (dev).
 * @returns {Function} Middleware Express.
 */
export function createSignatureAuthMiddleware() {
  const frontSecret = process.env.API_FRONT_SECRET || "";
  const adminSecret = process.env.API_ADMIN_SECRET || "";
  const allowedOrigins = new Set(
    (process.env.API_ALLOWED_ORIGINS || "")
      .split(",")
      .map((origin) => origin.trim().replace(/\/$/, "").toLowerCase())
      .filter(Boolean),
  );

  if (!frontSecret && !adminSecret) {
    logger.warn("[api] aucun secret configuré (API_FRONT_SECRET/API_ADMIN_SECRET) — API ouverte (dev)");
    return (req, res, next) => next();
  }

  return (req, res, next) => {
    if (req.path === "/api/health") return next();

    const auth = {
      ts: req.get("x-auth-ts") || "",
      nonce: req.get("x-auth-nonce") || "",
      sig: req.get("x-auth-sig") || "",
    };
    if (!auth.ts || !auth.nonce || !auth.sig) {
      return res.status(401).json({ error: "non autorisé (signature requise)" });
    }

    const now = Date.now();
    const tsMs = Number(auth.ts);
    if (!Number.isFinite(tsMs) || Math.abs(now - tsMs) > SIGNATURE_WINDOW_MS) {
      return res.status(401).json({ error: "non autorisé (signature expirée)" });
    }

    const isAdmin = matchesSecret(adminSecret, req, auth);
    const isFront = !isAdmin && matchesSecret(frontSecret, req, auth);
    if (!isAdmin && !isFront) {
      return res.status(401).json({ error: "non autorisé (signature invalide)" });
    }

    purgeExpiredNonces(now);
    if (seenNonces.has(auth.nonce)) {
      logger.warn(`[api] rejeu détecté sur ${req.method} ${req.path} (nonce déjà vu)`);
      return res.status(401).json({ error: "non autorisé (rejeu détecté)" });
    }
    seenNonces.set(auth.nonce, now + NONCE_TTL_MS);

    if (isFront) {
      const origin = req.get("origin");
      if (origin && !isOriginAllowed(origin, allowedOrigins)) {
        logger.warn(`[api] origin refusé : ${origin} sur ${req.method} ${req.path}`);
        return res.status(403).json({ error: "origine non autorisée" });
      }
    }

    next();
  };
}
