import { randomInt, randomBytes } from "node:crypto";
import type { Tokens, ReplyMeta } from "./gmail.ts";

export const PAIR_TTL_MS = 10 * 60 * 1000;
export type Session = { tokens: Tokens; replies: Map<string, ReplyMeta>; sent: Set<string>; sends: number };
type Pairing = { nonce: string; exp: number; session?: string };
export type Claim = { status: "pending" } | { status: "expired" } | { status: "linked"; session: string };

/** In-memory only: no emails and no tokens are ever written to disk. */
export function createStore() {
  const pairings = new Map<string, Pairing>();
  const sessions = new Map<string, Session>();
  const sweep = (now: number) => { for (const [c, p] of pairings) if (p.exp < now) pairings.delete(c); };

  return {
    startPairing(now = Date.now()): { code: string; expiresInSec: number } {
      sweep(now);
      if (pairings.size >= 50) throw new Error("too_many_pairings");
      let code = "";
      do { code = String(randomInt(100000, 1000000)); } while (pairings.has(code));
      pairings.set(code, { nonce: randomBytes(16).toString("hex"), exp: now + PAIR_TTL_MS });
      return { code, expiresInSec: PAIR_TTL_MS / 1000 };
    },
    /** Returns the one-time OAuth `state` for a valid pairing code. */
    beginAuth(code: string, now = Date.now()): string | null {
      sweep(now);
      const p = pairings.get(code);
      return p && !p.session ? p.nonce : null;
    },
    nonceValid(nonce: string, now = Date.now()): boolean {
      sweep(now);
      for (const p of pairings.values()) if (p.nonce === nonce && !p.session) return true;
      return false;
    },
    completeAuth(nonce: string, tokens: Tokens, now = Date.now()): boolean {
      sweep(now);
      for (const p of pairings.values()) {
        if (p.nonce === nonce && !p.session) {
          if (sessions.size >= 20) sessions.delete(sessions.keys().next().value as string);
          const sid = randomBytes(24).toString("hex");
          sessions.set(sid, { tokens, replies: new Map(), sent: new Set(), sends: 0 });
          p.session = sid;
          return true;
        }
      }
      return false;
    },
    claim(code: string, now = Date.now()): Claim {
      sweep(now);
      const p = pairings.get(code);
      if (!p) return { status: "expired" };
      if (!p.session) return { status: "pending" };
      pairings.delete(code); // the session id is handed out exactly once
      return { status: "linked", session: p.session };
    },
    getSession(sid: string | undefined): Session | undefined {
      return sid ? sessions.get(sid) : undefined;
    },
  };
}
export type Store = ReturnType<typeof createStore>;
