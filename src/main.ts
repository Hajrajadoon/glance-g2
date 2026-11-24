import { connectGlasses, type Glasses } from "./glasses.ts";
import {
  API, loadCards, loadBrief, redraft, transcribe, sendReply, health, checkSession, startPair, pairStatus,
  setSession, hasSession, readSavedSession, saveSession,
} from "./api.ts";
import { initial, reduce, render, currentCard, withDraft, interpretVoice, type State } from "./state.ts";

const MAX_RECORD_MS = 8000;
const RULE = "----------------------------------";
const $ = (id: string) => document.getElementById(id);

function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SEND_ERRORS: Record<string, string> = {
  not_linked: "Link expired. Restart app.",
  no_reply_address: "Can't reply: no-reply.",
  bad_address: "Can't reply: bad address.",
  network: "No connection.",
};

/** If Gmail is set up on the backend, show a pairing code on the glasses until the user signs in (or taps to skip). */
async function ensureLinked(glasses: Glasses): Promise<void> {
  const h = await health();
  if (!h?.gmail) return; // demo inbox
  const saved = readSavedSession();
  if (saved) {
    setSession(saved);
    if (await checkSession()) return;
    setSession(null);
    saveSession(null);
  }
  const pair = await startPair();
  if (!pair) return;
  let skip = false;
  glasses.onInput(() => { skip = true; });
  await glasses.show(`Link Gmail\n${RULE}\nOn your PC open:\n${API.replace(/^https?:\/\//, "")}/link\nCode: ${pair.code}\n\nTAP = use demo inbox`);
  const deadline = Date.now() + pair.expiresInSec * 1000;
  while (!skip && Date.now() < deadline) {
    await sleep(2000);
    const st = await pairStatus(pair.code);
    if (st?.status === "linked" && st.session) { setSession(st.session); saveSession(st.session); return; }
    if (st?.status === "expired") break;
  }
}

async function main() {
  const glasses: Glasses = await connectGlasses(`Glance\n${RULE}\nStarting...`);
  await ensureLinked(glasses);
  await glasses.show(`Glance\n${RULE}\nReading your inbox...`);
  const [{ cards, live }, brief] = await Promise.all([loadCards(), loadBrief()]);
  let state: State = initial(cards, brief);
  console.log(live ? "Loaded cards from backend" : "Using mock cards");
  await glasses.show(render(state));

  let busy = false;
  let recording = false;
  let chunks: Uint8Array[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  const status = (t: string) => { const el = $("status"); if (el) el.textContent = t; };
  const refresh = () => glasses.show(render(state));

  /** Runs one user command (spoken or typed) on the current draft. */
  async function applyCommand(text: string) {
    const cmd = interpretVoice(text);
    status(`Command: "${text}"`);
    if (cmd.kind === "send") state = reduce(state, "TAP");          // DRAFT -> CONFIRM (still needs a tap)
    else if (cmd.kind === "back") state = reduce(state, "DOUBLE_TAP");
    else if (cmd.kind === "edit") {
      const card = currentCard(state);
      if (card) {
        await glasses.show(`Heard: "${text}"`.slice(0, 34) + `\n${RULE}\nRewriting...`);
        const better = await redraft(`${card.who}: ${card.gist}`, card.draft, cmd.instruction);
        if (better) state = withDraft(state, card.id, better);
        else status("Rewrite failed, kept the old draft");
      }
    }
    await refresh();
  }

  async function startRecording() {
    chunks = [];
    await glasses.micStart((c) => chunks.push(c));
    recording = true;
    await glasses.show(`Listening...\n${RULE}\nSay: shorter, say no politely,\nsend it\n\nSWIPE to stop`);
    timer = setTimeout(() => { void exclusive(stopRecording); }, MAX_RECORD_MS);
  }

  async function stopRecording() {
    if (!recording) return;
    recording = false;
    clearTimeout(timer);
    await glasses.micStop();
    const pcm = concat(chunks);
    chunks = [];
    if (pcm.length < 6400) { status("Heard nothing"); await refresh(); return; }
    await glasses.show(`Thinking...\n${RULE}`);
    const text = await transcribe(pcm);
    if (!text) { status("Could not understand audio"); await glasses.show(`Didn't catch that\n${RULE}\nTry again: SWIPE`); return; }
    await applyCommand(text);
  }

  async function exclusive(fn: () => Promise<void>) {
    if (busy) return;
    busy = true;
    try { await fn(); } catch (e) { console.error("update failed", e); status("Error: " + (e as Error).message); try { recording = false; await refresh(); } catch {} }
    finally { busy = false; }
  }

  glasses.onInput((input) => {
    void exclusive(async () => {
      if (recording) { await stopRecording(); return; }          // any input while listening = stop
      if (state.screen === "DRAFT" && input === "NEXT") { await startRecording(); return; } // swipe down = speak
      if (state.screen === "DRAFT" && input === "PREV") { await applyCommand("make it shorter"); return; } // swipe up = quick shorter
      if (state.screen === "CONFIRM" && input === "TAP") {
        const card = currentCard(state);
        if (card && live && hasSession()) {            // real Gmail: actually send, and only move on if it worked
          await glasses.show(`Sending...\n${RULE}`);
          const r = await sendReply(card.id, card.draft);
          if (!r.ok) {
            status("Send failed: " + r.error);
            await glasses.show(`Not sent\n${RULE}\n${SEND_ERRORS[r.error ?? ""] ?? "Send failed."}\n\nTAP retry  2xTAP back`);
            return;
          }
        }
      }
      state = reduce(state, input);
      await refresh();
    });
  });

  // Typed commands from the page (great for the simulator and for recording your demo).
  const box = $("cmd") as HTMLInputElement | null;
  const go = () => {
    const v = box?.value.trim();
    if (!v) return;
    if (box) box.value = "";
    void exclusive(async () => {
      if (state.screen !== "DRAFT") { status("Open a draft first (Click on a card)"); return; }
      await applyCommand(v);
    });
  };
  $("go")?.addEventListener("click", go);
  box?.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  status("Ready");
}

main().catch((e) => console.error("Glance failed to start:", e));
