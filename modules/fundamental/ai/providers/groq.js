/**
 * Fournisseur LLM : Groq (palier gratuit, API compatible OpenAI).
 * Clé gratuite : process.env.GROQ_API_KEY (console.groq.com).
 * Modèle : GROQ_MODEL (def llama-3.3-70b-versatile).
 * Très rapide ; limites de débit sur le palier gratuit (OK en horaire).
 */
const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

export const name = "groq";

export async function complete({ system, user, timeout = 60000 }) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY absente du .env");
  const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

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
  if (!res.ok) throw new Error(`Groq HTTP ${res.status} : ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  return json.choices?.[0]?.message?.content ?? "";
}
