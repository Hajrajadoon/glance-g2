import { authUrl, exchangeCode, refreshAccess, listUnread, searchMails, nextEvent, prepareReply, sendRaw, type CalEventReal } from "./gmail.ts";
import { sanitizeMails, type Card, type Brief } from "./lib.ts";
import type { Mail } from "./mails.ts";
import type { Store, Session } from "./session.ts";

export type Cfg = { clientId: string; clientSecret: string; redirectUri: string; calendar: boolean };
export type Deps = {
  cfg: Cfg;
  f: typeof fetch;
  store: Store;
  triage: (mails: Mail[]) => Promise<{ cards: Card[]; source: string }>;
  briefAI: (ev: CalEventReal, related: Mail[]) => Promise<{ brief: Brief; source: string }>;
  demoCards: () => Promise<{ cards: Card[]; source: string }>;
  demoBrief: () => Promise<{ brief: Brief; source: string }>;
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const page = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:420px;margin:12vh auto;padding:0 20px;text-align:center}
input{font-size:32px;letter-spacing:8px;text-align:center;width:100%;padding:10px;box-sizing:border-box}
button{font-size:18px;padding:12px 20px;margin-top:16px;cursor:pointer}small{color:#666}</style>${body}`;

export function registerGoogle(app: { get: Function; post: Function }, d: Deps) {
  const configured = Boolean(d.cfg.clientId && d.cfg.clientSecret);

  const sessionOf = (req: any): Session | undefined => d.store.getSession(String(req.header?.("x-session") ?? ""));

  async function accessFor(s: Session): Promise<string> {
    if (s.tokens.expiresAt - Date.now() > 60_000) return s.tokens.access;
    if (!s.tokens.refresh) throw new Error("reauth_needed");
    const r = await refreshAccess({ clientId: d.cfg.clientId, clientSecret: d.cfg.clientSecret, refresh: s.tokens.refresh }, d.f);
    s.tokens = { ...s.tokens, access: r.access, expiresAt: r.expiresAt };
    return r.access;
  }

  // ---- pairing: the glasses show a code, the user enters it on a normal web page ----
  app.post("/pair/start", (_req: any, res: any) => {
    if (!configured) return res.status(503).json({ error: "gmail_not_configured" });
    try { res.json(d.store.startPairing()); } catch { res.status(429).json({ error: "too_many_pairings" }); }
  });

  app.get("/pair/status", (req: any, res: any) => {
    const code = String(req.query?.code ?? "").replace(/\D/g, "").slice(0, 6);
    res.json(d.store.claim(code));
  });

  app.get("/session", (req: any, res: any) => res.json({ ok: Boolean(sessionOf(req)) }));

  app.get("/link", (_req: any, res: any) => {
    if (!configured) return res.status(503).type("html").send(page("Glance", "<h2>Gmail is not set up</h2><p>Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env and restart the server.</p>"));
    res.type("html").send(page("Link Gmail", `<h2>Link your Gmail</h2><p>Enter the 6-digit code shown on your glasses.</p>
<form method="get" action="/auth/start"><input name="pair" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autofocus required placeholder="000000">
<button>Continue with Google</button></form><p><small>Glance reads your unread mail and sends a reply only after you tap to confirm. Nothing is stored.</small></p>`));
  });

  app.get("/auth/start", (req: any, res: any) => {
    if (!configured) return res.status(503).type("html").send(page("Glance", "<h2>Gmail is not set up</h2>"));
    const pair = String(req.query?.pair ?? "").replace(/\D/g, "").slice(0, 6);
    const state = d.store.beginAuth(pair);
    if (!state) return res.status(400).type("html").send(page("Glance", '<h2>Code expired or wrong</h2><p>Look at your glasses for a fresh code, then <a href="/link">try again</a>.</p>'));
    res.redirect(authUrl({ clientId: d.cfg.clientId, redirectUri: d.cfg.redirectUri, state, calendar: d.cfg.calendar }));
  });

  app.get("/auth/callback", async (req: any, res: any) => {
    const state = String(req.query?.state ?? "");
    const code = String(req.query?.code ?? "");
    if (req.query?.error || !code || !d.store.nonceValid(state)) {
      return res.status(400).type("html").send(page("Glance", `<h2>Could not link</h2><p>${esc(String(req.query?.error ?? "The link expired. Start again from the glasses."))}</p><a href="/link">Try again</a>`));
    }
    try {
      const tokens = await exchangeCode({ clientId: d.cfg.clientId, clientSecret: d.cfg.clientSecret, redirectUri: d.cfg.redirectUri, code }, d.f);
      d.store.completeAuth(state, tokens);
      res.type("html").send(page("Linked", "<h2>Linked &#10003;</h2><p>Look at your glasses. You can close this tab.</p>"));
    } catch (e) {
      console.warn("auth callback failed:", (e as Error).message);
      res.status(502).type("html").send(page("Glance", "<h2>Google sign-in failed</h2><p>Please try again.</p>"));
    }
  });

  // ---- inbox cards ----
  app.get("/cards", async (req: any, res: any) => {
    const s = sessionOf(req);
    if (!s) return res.json(await d.demoCards());
    try {
      const mails = await listUnread(await accessFor(s), d.f);
      const out = await d.triage(sanitizeMails(mails));
      console.log(`cards: Gmail returned ${mails.length} unread Primary mail(s) -> ${out.cards.length} card(s) (${out.source})` +
        (mails.length ? "  e.g. " + mails.slice(0, 3).map((m) => `"${m.subject.slice(0, 40)}"`).join(", ") : ""));
      s.replies.clear();
      for (const c of out.cards) {
        const m = mails.find((x) => x.id === c.id);
        if (m) s.replies.set(c.id, { to: m.replyTo || m.from, subject: m.subject, threadId: m.threadId, messageId: m.messageId });
      }
      res.json({ ...out, account: "gmail" });
    } catch (e) {
      console.warn("cards failed:", (e as Error).message);
      res.status(502).json({ error: "gmail_failed" });
    }
  });

  // ---- send: the client only names a card id; the recipient comes from what the server stored ----
  app.post("/send", async (req: any, res: any) => {
    const s = sessionOf(req);
    if (!s) return res.status(401).json({ error: "not_linked" });
    const id = String(req.body?.id ?? "");
    const body = String(req.body?.body ?? "").trim().slice(0, 1000);
    const meta = s.replies.get(id);
    if (!meta) return res.status(404).json({ error: "unknown_card" });
    if (!body) return res.status(400).json({ error: "empty_reply" });
    if (s.sent.has(id)) return res.status(409).json({ error: "already_sent" });
    if (s.sends >= 50) return res.status(429).json({ error: "send_limit" });
    try {
      const { raw, threadId } = prepareReply(meta, body);
      await sendRaw(await accessFor(s), raw, threadId, d.f);
      s.sent.add(id);
      s.sends += 1;
      res.json({ ok: true });
    } catch (e) {
      const m = (e as Error).message;
      console.warn("send failed:", m);
      res.status(m === "no_reply_address" || m === "bad_address" ? 422 : 502).json({ error: m === "no_reply_address" || m === "bad_address" ? m : "send_failed" });
    }
  });

  // ---- meeting brief ----
  app.get("/brief", async (req: any, res: any) => {
    const s = sessionOf(req);
    if (!s) return res.json(await d.demoBrief());
    if (!d.cfg.calendar) return res.json({ brief: null, source: "calendar_off" }); // never show a fake meeting to a real user
    try {
      const access = await accessFor(s);
      const ev = await nextEvent(access, d.f);
      if (!ev) return res.json({ brief: null, source: "calendar" });
      const emails = ev.emails.slice(0, 3);
      const related = emails.length ? sanitizeMails(await searchMails(access, emails.map((e) => `from:${e}`).join(" OR "), 3, d.f)) : [];
      res.json(await d.briefAI(ev, related));
    } catch (e) {
      console.warn("brief failed:", (e as Error).message);
      res.json({ brief: null, source: "error" });
    }
  });
}
