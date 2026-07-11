/**
 * Fournisseur LLM : DeepSeek (API compatible OpenAI).
 * Clé : process.env.DEEPSEEK_API_KEY. Modèle : DEEPSEEK_MODEL (def deepseek-chat).
 * Pas cher, bon raisonneur. NB : prudence possible sur géopol sensible Chine.
 */
const ENDPOINT = "https://api.deepseek.com/chat/completions";
const DEFAULT_MODEL = "deepseek-chat";
const DEFAULT_TIMEOUT_MS = 60000;
const TEMPERATURE = 0.3;
const MAX_TOKENS = 6000; // verdict JSON riche (10 axes + débutants + conseils + horizon/invalidation)
const ERROR_BODY_MAX_CHARS = 200;

export const name = "deepseek";

/**
 * Complétion chat : force une réponse JSON (response_format json_object).
 * @param {{ system: string, user: string, timeout?: number }} params Prompt
 *   système, message utilisateur, délai maximal en ms.
 * @returns {Promise<string>} Contenu texte de la réponse (JSON attendu).
 * @throws {Error} Clé absente, HTTP non-2xx ou timeout.
 */
export async function complete({ system, user, timeout = DEFAULT_TIMEOUT_MS }) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error("DEEPSEEK_API_KEY absente du .env");
  const model = process.env.DEEPSEEK_MODEL || DEFAULT_MODEL;

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
      temperature: TEMPERATURE,
      max_tokens: MAX_TOKENS,
    }),
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status} : ${(await res.text()).slice(0, ERROR_BODY_MAX_CHARS)}`);

  const json = await res.json();
  return json.choices?.[0]?.message?.content ?? "";
}
