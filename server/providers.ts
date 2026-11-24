import { extractJSON } from "./lib.ts";

type F = typeof fetch;
export const GROQ_BASE = "https://api.groq.com/openai/v1";

/** Chat completion on Groq that returns parsed JSON. `f` is injectable so it can be tested offline. */
export async function groqJSON(
  o: { key: string; model: string; system: string; user: string },
  f: F = fetch,
): Promise<unknown> {
  const call = (jsonMode: boolean) =>
    f(`${GROQ_BASE}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${o.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: o.model,
        temperature: 0.3,
        max_tokens: 1000,
        ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
        messages: [
          { role: "system", content: o.system },
          { role: "user", content: o.user },
        ],
      }),
      signal: AbortSignal.timeout(20000),
    });
  let r = await call(true);
  if (r.status === 400) r = await call(false); // some models reject JSON mode: retry plain
  if (!r.ok) throw new Error(`groq_${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { choices?: { message?: { content?: string } }[] };
  return extractJSON(j.choices?.[0]?.message?.content ?? "");
}

/** Speech to text with Whisper on Groq. */
export async function groqTranscribe(
  o: { key: string; model: string; wav: Uint8Array; language?: string },
  f: F = fetch,
): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([o.wav], { type: "audio/wav" }), "speech.wav");
  form.append("model", o.model);
  form.append("response_format", "json");
  form.append("temperature", "0");
  if (o.language) form.append("language", o.language);
  const r = await f(`${GROQ_BASE}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${o.key}` },
    body: form,
    signal: AbortSignal.timeout(25000),
  });
  if (!r.ok) throw new Error(`groq_stt_${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { text?: string };
  return String(j.text ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
}
