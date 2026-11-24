import express from "express";
import cors from "cors";
import Anthropic from "@anthropic-ai/sdk";
import { RAW_MAILS, type Mail } from "./mails.ts";
import {
  TRIAGE_SYSTEM, REDRAFT_SYSTEM, BRIEF_SYSTEM, extractJSON, clampCards, clampBrief, sanitizeMails,
  offlineTriage, offlineRedraft, offlineBrief, pcmToWav, redraftOk, type Card,
} from "./lib.ts";
import { groqJSON, groqTranscribe } from "./providers.ts";
import { MOCK_EVENT, relatedMails } from "./calendar.ts";
import { registerGoogle } from "./google.ts";
import { createStore } from "./session.ts";

const PORT = Number(process.env.PORT) || 8787;
const demoOnly = process.env.DEMO === "1";
const anthropicKey = (process.env.ANTHROPIC_API_KEY || "").trim();
const groqKey = (process.env.GROQ_API_KEY || "").trim();
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5-5";
// Tried in order; a model Groq says does not exist (404) is skipped and the next one is used.
const GROQ_MODELS = [process.env.GROQ_MODEL, "llama-3.1-8b-instant", "openai/gpt-oss-20b", "openai/gpt-oss-120b", "llama-3.3-70b-versatile"]
  .filter((m, i, a): m is string => Boolean(m) && a.indexOf(m) === i);
let groqModel = GROQ_MODELS[0];
const STT_MODEL = process.env.STT_MODEL || "whisper-large-v3-turbo";
const STT_LANGUAGE = process.env.STT_LANGUAGE || "en";

const googleCfg = {
  clientId: (process.env.GOOGLE_CLIENT_ID || "").trim(),
  clientSecret: (process.env.GOOGLE_CLIENT_SECRET || "").trim(),
  redirectUri: (process.env.GOOGLE_REDIRECT_URI || `http://localhost:${PORT}/auth/callback`).trim(),
  calendar: process.env.GOOGLE_CALENDAR === "1",
};
const gmailReady = Boolean(googleCfg.clientId && googleCfg.clientSecret) && !demoOnly;

const claude = !demoOnly && anthropicKey ? new Anthropic({ apiKey: anthropicKey }) : null;
const provider: "claude" | "groq" | "offline" = demoOnly ? "offline" : claude ? "claude" : groqKey ? "groq" : "offline";

/** One place that decides which AI answers. Throws if none is available. */
async function askJSON(system: string, user: string): Promise<unknown> {
  if (provider === "claude" && claude) {
    const r = await claude.messages.create(
      { model: CLAUDE_MODEL, max_tokens: 1000, system, messages: [{ role: "user", content: user }] },
      { timeout: 20000 },
    );
    return extractJSON(r.content.map((b) => (b.type === "text" ? b.text : "")).join(""));
  }
  if (provider === "groq") {
    let lastErr: unknown;
    for (const model of [groqModel, ...GROQ_MODELS.filter((m) => m !== groqModel)]) {
      try {
        const out = await groqJSON({ key: groqKey, model, system, user });
        if (model !== groqModel) { groqModel = model; console.log(`  Groq model switched to ${model}`); }
        return out;
      } catch (e) {
        lastErr = e;
        if (!/groq_(404|403)/.test((e as Error).message)) throw e; // only skip models that are missing / not allowed
      }
    }
    throw lastErr;
  }
  throw new Error("no_key");
}

async function triage(mails: Mail[]): Promise<{ cards: Card[]; source: string }> {
  try {
    const cards = clampCards(await askJSON(TRIAGE_SYSTEM, JSON.stringify(mails)), mails);
    if (cards.length) return { cards, source: provider };
  } catch (e) {
    console.warn("triage: using offline rules:", (e as Error).message);
  }
  return { cards: offlineTriage(mails), source: "offline" };
}

async function briefAI(ev: { title: string; startsInMin: number; attendees: string[] }, related: Mail[]) {
  const fallback = offlineBrief(ev, related);
  try {
    const raw = await askJSON(BRIEF_SYSTEM, JSON.stringify({ event: { title: ev.title, attendees: ev.attendees }, emails: related }));
    return { brief: clampBrief(raw, fallback), source: provider as string };
  } catch (e) {
    console.warn("brief: using offline rules:", (e as Error).message);
    return { brief: fallback, source: "offline" };
  }
}

const app = express();
app.use(cors({ origin: process.env.APP_ORIGIN || true })); // Day 5: set APP_ORIGIN to lock this down
app.use(express.json({ limit: "200kb" }));

app.get("/health", (_req, res) =>
  res.json({ ok: true, provider, voice: Boolean(groqKey) && !demoOnly, gmail: gmailReady, calendar: gmailReady && googleCfg.calendar }));

// Gmail login, inbox cards, send and meeting brief (falls back to the demo inbox when nobody is linked)
registerGoogle(app, {
  cfg: googleCfg,
  f: fetch,
  store: createStore(),
  triage,
  briefAI,
  demoCards: () => triage(sanitizeMails(RAW_MAILS)),
  demoBrief: () => briefAI(MOCK_EVENT, relatedMails(MOCK_EVENT, sanitizeMails(RAW_MAILS))),
});

app.post("/triage", async (req, res) => {
  const mails = sanitizeMails(req.body?.mails);
  if (!mails.length) return res.status(400).json({ error: "no_mails" });
  res.json(await triage(mails));
});

app.post("/redraft", async (req, res) => {
  const original = String(req.body?.original ?? "").slice(0, 500);
  const draft = String(req.body?.draft ?? "").slice(0, 500);
  const instruction = String(req.body?.instruction ?? "").slice(0, 100);
  if (!draft || !instruction) return res.status(400).json({ error: "bad_request" });
  try {
    const raw = (await askJSON(REDRAFT_SYSTEM, JSON.stringify({ original, draft, instruction }))) as { draft?: string };
    const out = String(raw?.draft ?? "").replace(/\s+/g, " ").trim().slice(0, 240);
    if (redraftOk(out, { original, draft, instruction })) return res.json({ draft: out, source: provider });
    console.warn("redraft: AI answer rejected (invented detail or ignored the instruction), using offline rules:", out);
  } catch (e) {
    console.warn("redraft: using offline rules:", (e as Error).message);
  }
  res.json({ draft: offlineRedraft(draft, instruction), source: "offline" });
});

// Raw 16 kHz 16-bit mono PCM from the glasses microphone -> text
app.post("/transcribe", express.raw({ type: "application/octet-stream", limit: "1mb" }), async (req, res) => {
  if (!groqKey || demoOnly) return res.status(503).json({ error: "no_stt_key" });
  const pcm = req.body as Buffer;
  if (!Buffer.isBuffer(pcm) || pcm.length < 6400) return res.status(400).json({ error: "audio_too_short" });
  try {
    const text = await groqTranscribe({ key: groqKey, model: STT_MODEL, wav: pcmToWav(pcm), language: STT_LANGUAGE });
    res.json({ text });
  } catch (e) {
    console.warn("transcribe failed:", (e as Error).message);
    res.status(502).json({ error: "stt_failed" });
  }
});

app.listen(PORT, () => {
  console.log(`Glance backend on http://localhost:${PORT}`);
  console.log(`  AI drafts : ${provider === "offline" ? "OFFLINE rules (no key found)" : provider === "claude" ? "Claude" : "Groq " + groqModel}`);
  console.log(`  Voice     : ${groqKey && !demoOnly ? "Groq Whisper " + STT_MODEL : "off (no GROQ_API_KEY)"}`);
  console.log(`  Gmail     : ${gmailReady ? "ready (link at http://localhost:" + PORT + "/link)" + (googleCfg.calendar ? " + Calendar" : "") : "not set up (demo inbox)"}`);
});
