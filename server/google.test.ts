import test from "node:test";
import assert from "node:assert/strict";
import {
  authUrl, buildRaw, prepareReply, parseAddress, decodeEntities, exchangeCode, searchMails, nextEvent,
} from "./gmail.ts";
import { createStore } from "./session.ts";
import { registerGoogle } from "./google.ts";
import { offlineTriage, offlineBrief, clampBrief } from "./lib.ts";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const decodeRaw = (raw: string) => Buffer.from(raw, "base64url").toString("utf8");

test("authUrl asks for offline access and the right scopes", () => {
  const u = new URL(authUrl({ clientId: "CID", redirectUri: "http://localhost:8787/auth/callback", state: "S", calendar: false }));
  assert.equal(u.searchParams.get("client_id"), "CID");
  assert.equal(u.searchParams.get("access_type"), "offline");
  assert.equal(u.searchParams.get("state"), "S");
  const sc = u.searchParams.get("scope")!;
  assert.ok(sc.includes("gmail.readonly") && sc.includes("gmail.send") && !sc.includes("calendar"));
  assert.ok(new URL(authUrl({ clientId: "C", redirectUri: "r", state: "s", calendar: true })).searchParams.get("scope")!.includes("calendar.readonly"));
});

test("buildRaw makes a valid reply and blocks header injection", () => {
  const raw = decodeRaw(buildRaw({ to: "a@b.com", subject: "Hi\r\nBcc: evil@x.com", body: "Thanks!\nBye", inReplyTo: "<m1@x>" }));
  const head = raw.split("\r\n\r\n")[0];
  assert.ok(head.includes("To: a@b.com") && head.includes("In-Reply-To: <m1@x>"));
  assert.ok(!/^Bcc:/m.test(raw));
  const body = Buffer.from(raw.split("\r\n\r\n")[1].replace(/\r\n/g, ""), "base64").toString("utf8");
  assert.equal(body, "Thanks!\nBye");
  assert.ok(decodeRaw(buildRaw({ to: "a@b.com", subject: "Café", body: "x" })).includes("=?UTF-8?B?"));
});

test("prepareReply refuses no-reply and malformed addresses", () => {
  const meta = { to: "Sara Khan <sara@studio.example>", subject: "Review", threadId: "t1", messageId: "<m@x>" };
  const ok = prepareReply(meta, "Sure.");
  assert.equal(ok.threadId, "t1");
  assert.match(decodeRaw(ok.raw), /^To: sara@studio\.example\r\nSubject: Re: Review/);
  assert.throws(() => prepareReply({ ...meta, to: "no-reply@x.com" }, "hi"), /no_reply_address/);
  assert.throws(() => prepareReply({ ...meta, to: "not an address" }, "hi"), /bad_address/);
});

test("parseAddress and decodeEntities", () => {
  assert.deepEqual(parseAddress('"Ali Raza" <ali@f.com>'), { name: "Ali Raza", email: "ali@f.com" });
  assert.deepEqual(parseAddress("x@y.com"), { name: "", email: "x@y.com" });
  assert.equal(decodeEntities("It&#39;s &amp; &quot;ok&quot;"), `It's & "ok"`);
});

test("exchangeCode posts a form and returns tokens", async () => {
  let seen: any;
  const f = (async (u: string, init: any) => { seen = { u, init }; return json({ access_token: "A", refresh_token: "R", expires_in: 100 }); }) as any;
  const t = await exchangeCode({ clientId: "c", clientSecret: "s", redirectUri: "r", code: "x" }, f, 1000);
  assert.deepEqual(t, { access: "A", refresh: "R", expiresAt: 101000 });
  assert.equal(seen.u, "https://oauth2.googleapis.com/token");
  assert.ok(seen.init.body.includes("grant_type=authorization_code"));
});

function fakeGoogle(sent: any[] = []) {
  return (async (url: string, init: any) => {
    if (url.startsWith("https://oauth2.googleapis.com/token")) return json({ access_token: "ACC", refresh_token: "REF", expires_in: 3600 });
    if (url.includes("/messages/send")) { sent.push(JSON.parse(init.body)); return json({ id: "sent1" }); }
    if (/\/messages\?/.test(url)) return json({ messages: [{ id: "g1", threadId: "t1" }, { id: "g2", threadId: "t2" }, { id: "g3", threadId: "t3" }] });
    const m = /\/messages\/(g\d)\?/.exec(url);
    if (m) {
      const data: any = {
        g1: { from: "Sara Khan <sara@studio.example>", subject: "Can we move Thursday's review?", snippet: "Could we do Friday instead? It&#39;s urgent.", mid: "<m1@x>" },
        g2: { from: "Shop <no-reply@shop.example>", subject: "50% sale", snippet: "Sale now", mid: "<m2@x>" },
        g3: { from: "Ali Raza <ali@finance.example>", subject: "Invoice approval today", snippet: "Please approve invoice 2041", mid: "<m3@x>" },
      }[m[1]];
      return json({ threadId: "T-" + m[1], snippet: data.snippet, payload: { headers: [
        { name: "From", value: data.from }, { name: "Subject", value: data.subject }, { name: "Message-ID", value: data.mid }] } });
    }
    if (url.includes("/calendar/v3/")) return json({ items: [
      { status: "cancelled", start: { dateTime: "2026-11-24T10:00:00Z" } },
      { summary: "All day", start: { date: "2026-11-24" } },
      { summary: "Design review", start: { dateTime: new Date(Date.now() + 10 * 60000).toISOString() }, end: { dateTime: new Date(Date.now() + 70 * 60000).toISOString() },
        attendees: [{ email: "me@x.com", self: true }, { email: "sara@studio.example", displayName: "Sara Khan" }, { email: "room@r.com", resource: true }] },
    ] });
    return new Response("nope", { status: 404 });
  }) as any;
}

test("searchMails and nextEvent parse Google replies", async () => {
  const f = fakeGoogle();
  const mails = await searchMails("ACC", "is:unread", 5, f);
  assert.equal(mails.length, 3);
  assert.equal(mails[0].snippet, "Could we do Friday instead? It's urgent.");
  assert.equal(mails[0].messageId, "<m1@x>");
  const ev = await nextEvent("ACC", f);
  assert.equal(ev?.title, "Design review");
  assert.deepEqual(ev?.attendees, ["Sara Khan"]);
  assert.deepEqual(ev?.emails, ["sara@studio.example"]);
  assert.ok(ev!.startsInMin >= 9 && ev!.startsInMin <= 10);
});

test("pairing lifecycle: code, one-time state, claim once, expiry", () => {
  const st = createStore();
  const { code } = st.startPairing(0);
  assert.match(code, /^\d{6}$/);
  assert.deepEqual(st.claim(code, 1), { status: "pending" });
  const nonce = st.beginAuth(code, 1)!;
  assert.ok(nonce && st.nonceValid(nonce, 1));
  assert.equal(st.beginAuth("000000", 1), null);
  assert.ok(st.completeAuth(nonce, { access: "a", expiresAt: 9e12 }, 2));
  assert.equal(st.completeAuth(nonce, { access: "a", expiresAt: 9e12 }, 3), false); // state is single use
  const c1: any = st.claim(code, 4);
  assert.equal(c1.status, "linked");
  assert.ok(st.getSession(c1.session));
  assert.deepEqual(st.claim(code, 5), { status: "expired" }); // handed out once
  const p2 = st.startPairing(0);
  assert.deepEqual(st.claim(p2.code, 11 * 60 * 1000), { status: "expired" });
});

// ---- whole flow through the real route handlers with fake express + fake Google ----
function fakeApp() {
  const routes: Record<string, Function> = {};
  return {
    routes,
    get: (p: string, h: Function) => { routes["GET " + p] = h; },
    post: (p: string, h: Function) => { routes["POST " + p] = h; },
  };
}
async function call(app: any, key: string, o: { query?: any; body?: any; session?: string } = {}) {
  const res: any = {
    statusCode: 200, body: undefined, redirected: undefined,
    status(c: number) { this.statusCode = c; return this; }, json(b: any) { this.body = b; return this; },
    type() { return this; }, send(b: any) { this.body = b; return this; }, redirect(u: string) { this.redirected = u; return this; },
  };
  await app.routes[key]({ query: o.query ?? {}, body: o.body ?? {}, header: (n: string) => (n.toLowerCase() === "x-session" ? o.session : undefined) }, res);
  return res;
}

test("end to end: link Gmail, read cards, send a reply, and the safety rules hold", async () => {
  const sent: any[] = [];
  const app = fakeApp();
  const demo = { cards: [{ id: "demo", who: "D", gist: "g", draft: "d" }], source: "offline" };
  registerGoogle(app, {
    cfg: { clientId: "cid", clientSecret: "sec", redirectUri: "http://localhost:8787/auth/callback", calendar: true },
    f: fakeGoogle(sent), store: createStore(),
    triage: async (mails) => ({ cards: offlineTriage(mails), source: "offline" }),
    briefAI: async (ev, related) => ({ brief: clampBrief(null, offlineBrief(ev, related)), source: "offline" }),
    demoCards: async () => demo,
    demoBrief: async () => ({ brief: clampBrief(null, offlineBrief({ title: "Demo", startsInMin: 5, attendees: ["A"] }, [])), source: "offline" }),
  });

  // not linked: demo data, no sending
  assert.deepEqual((await call(app, "GET /cards")).body, demo);
  assert.equal((await call(app, "POST /send", { body: { id: "g1", body: "hi" } })).statusCode, 401);

  // pair + sign in
  const { code } = (await call(app, "POST /pair/start")).body;
  assert.equal((await call(app, "GET /auth/start", { query: { pair: "111111" } })).statusCode, 400);
  const start = await call(app, "GET /auth/start", { query: { pair: code } });
  const state = new URL(start.redirected).searchParams.get("state")!;
  assert.equal((await call(app, "GET /auth/callback", { query: { code: "G", state: "wrong" } })).statusCode, 400);
  assert.equal((await call(app, "GET /auth/callback", { query: { code: "G", state } })).statusCode, 200);
  const claimed = (await call(app, "GET /pair/status", { query: { code } })).body;
  assert.equal(claimed.status, "linked");
  const sid = claimed.session;
  assert.equal((await call(app, "GET /session", { session: sid })).body.ok, true);
  assert.equal((await call(app, "GET /session", { session: "bad" })).body.ok, false);

  // real cards: no-reply mail skipped, ids are Gmail ids
  const cards = (await call(app, "GET /cards", { session: sid })).body;
  assert.deepEqual(cards.cards.map((c: any) => c.id), ["g1", "g3"]);
  assert.equal(cards.account, "gmail");

  // send: recipient comes from the stored email, the client cannot choose it
  assert.equal((await call(app, "POST /send", { session: sid, body: { id: "g2", body: "hi" } })).statusCode, 404);
  assert.equal((await call(app, "POST /send", { session: sid, body: { id: "g1", body: "  " } })).statusCode, 400);
  const ok = await call(app, "POST /send", { session: sid, body: { id: "g1", body: "Friday works.", to: "evil@x.com" } });
  assert.equal(ok.statusCode, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].threadId, "T-g1");
  const raw = decodeRaw(sent[0].raw);
  assert.ok(raw.startsWith("To: sara@studio.example\r\n") && !raw.includes("evil@x.com"));
  assert.equal((await call(app, "POST /send", { session: sid, body: { id: "g1", body: "again" } })).statusCode, 409);
  assert.equal(sent.length, 1);

  // brief from the real calendar
  const brief = (await call(app, "GET /brief", { session: sid })).body;
  assert.equal(brief.brief.title, "Design review");
  assert.equal(brief.brief.who, "Sara");
});

test("without Gmail configured, pairing says so and the demo still works", async () => {
  const app = fakeApp();
  registerGoogle(app, {
    cfg: { clientId: "", clientSecret: "", redirectUri: "", calendar: false }, f: fakeGoogle(), store: createStore(),
    triage: async () => ({ cards: [], source: "x" }), briefAI: async () => ({ brief: clampBrief(null, offlineBrief({ title: "T", startsInMin: 1, attendees: [] }, [])), source: "x" }),
    demoCards: async () => ({ cards: [], source: "demo" }), demoBrief: async () => ({ brief: clampBrief(null, offlineBrief({ title: "T", startsInMin: 1, attendees: [] }, [])), source: "demo" }),
  });
  assert.equal((await call(app, "POST /pair/start")).statusCode, 503);
  assert.equal((await call(app, "GET /cards")).body.source, "demo");
});
