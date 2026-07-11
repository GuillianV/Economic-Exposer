/**
 * Fournisseur LLM : Google Gemini (palier gratuit).
 * Clé gratuite : process.env.GEMINI_API_KEY (Google AI Studio).
 * Modèle : GEMINI_MODEL (def gemini-2.0-flash).
 */
const DEFAULT_MODEL = "gemini-2.0-flash";
const DEFAULT_TIMEOUT_MS = 60000;
const TEMPERATURE = 0.3;
const MAX_OUTPUT_TOKENS = 6000;
const ERROR_BODY_MAX_CHARS = 200;

export const name = "gemini";

/**
 * Complétion chat : force une réponse JSON (responseMimeType application/json).
 * @param {{ system: string, user: string, timeout?: number }} params Prompt
 *   système, message utilisateur, délai maximal en ms.
 * @returns {Promise<string>} Contenu texte de la réponse (JSON attendu).
 * @throws {Error} Clé absente, HTTP non-2xx ou timeout.
 */
export async function complete({ system, user, timeout = DEFAULT_TIMEOUT_MS }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY absente du .env");
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { temperature: TEMPERATURE, responseMimeType: "application/json", maxOutputTokens: MAX_OUTPUT_TOKENS },
    }),
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status} : ${(await res.text()).slice(0, ERROR_BODY_MAX_CHARS)}`);

  const json = await res.json();
  return json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}
