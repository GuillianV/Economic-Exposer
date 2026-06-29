/**
 * Fournisseur LLM : Google Gemini (palier gratuit).
 * Clé gratuite : process.env.GEMINI_API_KEY (Google AI Studio).
 * Modèle : GEMINI_MODEL (def gemini-2.0-flash).
 */
export const name = "gemini";

export async function complete({ system, user, timeout = 60000 }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY absente du .env");
  const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { temperature: 0.3, responseMimeType: "application/json", maxOutputTokens: 3000 },
    }),
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status} : ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  return json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}
