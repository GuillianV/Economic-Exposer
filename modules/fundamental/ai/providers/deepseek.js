/**
 * Fournisseur LLM : DeepSeek (API compatible OpenAI).
 * Clé : process.env.DEEPSEEK_API_KEY. Modèle : DEEPSEEK_MODEL (def deepseek-chat).
 * Pas cher, bon raisonneur. NB : prudence possible sur géopol sensible Chine.
 */
const ENDPOINT = "https://api.deepseek.com/chat/completions";

export const name = "deepseek";

export async function complete({ system, user, timeout = 60000 }) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error("DEEPSEEK_API_KEY absente du .env");
  const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";

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
      temperature: 0.3,
      max_tokens: 3000,
    }),
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status} : ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  return json.choices?.[0]?.message?.content ?? "";
}
