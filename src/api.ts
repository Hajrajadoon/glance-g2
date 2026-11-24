import type { Card, Brief } from "./mock.ts";
import { MOCK_CARDS, MOCK_BRIEF } from "./mock.ts";

export const API: string = (import.meta as any).env?.VITE_API_URL || "http://localhost:8787";

let SESSION: string | null = null;
export const setSession = (s: string | null) => { SESSION = s; };
export const hasSession = () => Boolean(SESSION);
const hdr = (): Record<string, string> => (SESSION ? { "X-Session": SESSION } : {});

const SAVE_KEY = "glance.session";
export function readSavedSession(): string | null {
  try { return localStorage.getItem(SAVE_KEY); } catch { return null; }
}
export function saveSession(s: string | null) {
  try { s ? localStorage.setItem(SAVE_KEY, s) : localStorage.removeItem(SAVE_KEY); } catch { /* storage can be unavailable */ }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(API + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...hdr() },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25000),
  });
  if (!r.ok) throw new Error(`${path} ${r.status}`);
  return r.json() as Promise<T>;
}

export async function health(): Promise<{ gmail?: boolean; calendar?: boolean; voice?: boolean } | null> {
  try {
    const r = await fetch(API + "/health", { signal: AbortSignal.timeout(5000) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

export async function checkSession(): Promise<boolean> {
  try {
    const r = await fetch(API + "/session", { headers: hdr(), signal: AbortSignal.timeout(5000) });
    return r.ok && Boolean(((await r.json()) as { ok?: boolean }).ok);
  } catch { return false; }
}

export async function startPair(): Promise<{ code: string; expiresInSec: number } | null> {
  try { return await post("/pair/start", {}); } catch { return null; }
}

export async function pairStatus(code: string): Promise<{ status: string; session?: string } | null> {
  try {
    const r = await fetch(`${API}/pair/status?code=${encodeURIComponent(code)}`, { signal: AbortSignal.timeout(5000) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

/** Cards from the backend (real Gmail when linked); if it is down, the app still works on built-in mock cards. */
export async function loadCards(): Promise<{ cards: Card[]; live: boolean }> {
  try {
    const r = await fetch(API + "/cards", { headers: hdr(), signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(String(r.status));
    const data = (await r.json()) as { cards: Card[] };
    // A linked account with an empty inbox is real "inbox zero", not a reason to show demo mail.
    if (Array.isArray(data.cards) && (data.cards.length || SESSION)) return { cards: data.cards, live: true };
  } catch (e) {
    console.warn("backend unavailable, using mock cards:", e);
  }
  return { cards: MOCK_CARDS, live: false };
}

/** Next-meeting brief. null = no meeting to show. Falls back to a demo brief only when the backend is down. */
export async function loadBrief(): Promise<Brief | null> {
  try {
    const r = await fetch(API + "/brief", { headers: hdr(), signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(String(r.status));
    const data = (await r.json()) as { brief?: Brief | null };
    if (data.brief === null) return null;
    if (data.brief?.title) return data.brief;
  } catch (e) {
    console.warn("brief unavailable, using demo brief:", e);
  }
  return MOCK_BRIEF;
}

/** Returns the new draft, or null if it failed (caller keeps the old draft). */
export async function redraft(original: string, draft: string, instruction: string): Promise<string | null> {
  try {
    const r = await post<{ draft: string }>("/redraft", { original, draft, instruction });
    return r.draft || null;
  } catch (e) {
    console.warn("redraft failed:", e);
    return null;
  }
}

/** Sends the reply through Gmail. The server picks the recipient from the stored email. */
export async function sendReply(id: string, body: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(API + "/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...hdr() },
      body: JSON.stringify({ id, body }),
      signal: AbortSignal.timeout(25000),
    });
    if (r.ok) return { ok: true };
    const err = ((await r.json().catch(() => ({}))) as { error?: string }).error ?? String(r.status);
    return err === "already_sent" ? { ok: true } : { ok: false, error: err };
  } catch {
    return { ok: false, error: "network" };
  }
}

/** Raw PCM from the glasses -> text. Returns null on any failure. */
export async function transcribe(pcm: Uint8Array): Promise<string | null> {
  try {
    const r = await fetch(API + "/transcribe", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: pcm as unknown as BodyInit,
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw new Error(String(r.status));
    return ((await r.json()) as { text?: string }).text?.trim() || null;
  } catch (e) {
    console.warn("transcribe failed:", e);
    return null;
  }
}
