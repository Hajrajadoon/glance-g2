// Gmail + Calendar over plain fetch (no googleapis dependency). `f` is injectable so everything is testable offline.
type F = typeof fetch;

export type Tokens = { access: string; refresh?: string; expiresAt: number };
export type ReplyMeta = { to: string; subject: string; threadId: string; messageId: string };
export type GmailMail = { id: string; threadId: string; from: string; replyTo: string; subject: string; snippet: string; messageId: string };
export type CalEventReal = { title: string; startsInMin: number; attendees: string[]; emails: string[] };

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.send"];
const SCOPE_CAL = "https://www.googleapis.com/auth/calendar.readonly";
const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;

export const UNREAD_QUERY = "is:unread in:inbox -category:promotions -category:social -category:updates -category:forums";

export function authUrl(o: { clientId: string; redirectUri: string; state: string; calendar: boolean }): string {
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", o.clientId);
  u.searchParams.set("redirect_uri", o.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", (o.calendar ? [...SCOPES, SCOPE_CAL] : SCOPES).join(" "));
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("state", o.state);
  return u.toString();
}

async function tokenCall(body: Record<string, string>, f: F): Promise<{ access_token: string; refresh_token?: string; expires_in?: number }> {
  const r = await f("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`google_token_${r.status}`);
  const j = (await r.json()) as any;
  if (!j?.access_token) throw new Error("google_token_missing");
  return j;
}

export async function exchangeCode(
  o: { clientId: string; clientSecret: string; redirectUri: string; code: string }, f: F = fetch, now = Date.now(),
): Promise<Tokens> {
  const j = await tokenCall({ code: o.code, client_id: o.clientId, client_secret: o.clientSecret, redirect_uri: o.redirectUri, grant_type: "authorization_code" }, f);
  return { access: j.access_token, refresh: j.refresh_token, expiresAt: now + (j.expires_in ?? 3600) * 1000 };
}

export async function refreshAccess(
  o: { clientId: string; clientSecret: string; refresh: string }, f: F = fetch, now = Date.now(),
): Promise<{ access: string; expiresAt: number }> {
  const j = await tokenCall({ refresh_token: o.refresh, client_id: o.clientId, client_secret: o.clientSecret, grant_type: "refresh_token" }, f);
  return { access: j.access_token, expiresAt: now + (j.expires_in ?? 3600) * 1000 };
}

async function gget(access: string, url: string, f: F): Promise<any> {
  const r = await f(url, { headers: { Authorization: `Bearer ${access}` }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`google_${r.status}`);
  return r.json();
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

export function parseAddress(from: string): { name: string; email: string } {
  const m = /^(.*?)<([^>]+)>\s*$/.exec(from.trim());
  if (m) return { name: m[1].replace(/["']/g, "").trim(), email: m[2].trim() };
  return { name: "", email: from.trim() };
}

const headerSafe = (s: string) => s.replace(/[\r\n]+/g, " ").trim();
const wrap76 = (b64: string) => b64.replace(/(.{76})/g, "$1\r\n");

/** Builds a plain-text reply as a base64url RFC 2822 message. Headers can never be injected through newlines. */
export function buildRaw(o: { to: string; subject: string; body: string; inReplyTo?: string; references?: string }): string {
  const subject = headerSafe(o.subject);
  const encSubject = /[^\x20-\x7e]/.test(subject) ? `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=` : subject;
  const lines = [`To: ${headerSafe(o.to)}`, `Subject: ${encSubject}`];
  const mid = headerSafe(o.inReplyTo ?? "");
  if (/^<[^<>\s]+>$/.test(mid)) { lines.push(`In-Reply-To: ${mid}`, `References: ${mid}`); }
  lines.push("MIME-Version: 1.0", 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64", "",
    wrap76(Buffer.from(o.body, "utf8").toString("base64")));
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

/** Decides who gets the reply (always taken from the stored email, never from the glasses) and builds the message. */
export function prepareReply(meta: ReplyMeta, body: string): { raw: string; threadId: string } {
  const addr = parseAddress(meta.to).email;
  if (!EMAIL_RE.test(addr)) throw new Error("bad_address");
  if (/(^|[._-])(no-?reply|do-?not-?reply|mailer-daemon|notifications?)@/i.test(addr)) throw new Error("no_reply_address");
  const subject = headerSafe(meta.subject);
  const subj = /^re:/i.test(subject) ? subject : `Re: ${subject}`;
  return { raw: buildRaw({ to: addr, subject: subj, body, inReplyTo: meta.messageId }), threadId: meta.threadId };
}

export async function sendRaw(access: string, raw: string, threadId: string, f: F = fetch): Promise<void> {
  const r = await f(`${GMAIL}/messages/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw, ...(threadId ? { threadId } : {}) }),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`google_send_${r.status}`);
}

/** Search the mailbox and return light metadata (no bodies, nothing is stored). */
export async function searchMails(access: string, q: string, max: number, f: F = fetch): Promise<GmailMail[]> {
  const list = new URLSearchParams({ q, maxResults: String(max) });
  const ids: { id: string; threadId: string }[] = (await gget(access, `${GMAIL}/messages?${list}`, f)).messages ?? [];
  const one = async (m: { id: string; threadId: string }): Promise<GmailMail | null> => {
    try {
      const p = new URLSearchParams({ format: "metadata" });
      for (const h of ["From", "Subject", "Message-ID", "Reply-To"]) p.append("metadataHeaders", h);
      const j = await gget(access, `${GMAIL}/messages/${encodeURIComponent(m.id)}?${p}`, f);
      const hdr = (n: string) => String((j.payload?.headers ?? []).find((h: any) => String(h.name).toLowerCase() === n.toLowerCase())?.value ?? "");
      return { id: m.id, threadId: j.threadId ?? m.threadId, from: hdr("From"), replyTo: hdr("Reply-To"), subject: hdr("Subject") || "(no subject)", snippet: decodeEntities(String(j.snippet ?? "")), messageId: hdr("Message-ID") };
    } catch { return null; }
  };
  return (await Promise.all(ids.slice(0, max).map(one))).filter((m): m is GmailMail => m !== null);
}

export const listUnread = (access: string, f: F = fetch, max = 15) => searchMails(access, UNREAD_QUERY, max, f);

/** Next timed meeting in the coming 24 hours, or null. */
export async function nextEvent(access: string, f: F = fetch, now = Date.now()): Promise<CalEventReal | null> {
  const p = new URLSearchParams({ timeMin: new Date(now).toISOString(), timeMax: new Date(now + 24 * 3600 * 1000).toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "10" });
  const j = await gget(access, `https://www.googleapis.com/calendar/v3/calendars/primary/events?${p}`, f);
  for (const e of j.items ?? []) {
    if (e.status === "cancelled" || !e.start?.dateTime) continue;
    const start = Date.parse(e.start.dateTime);
    const end = Date.parse(e.end?.dateTime ?? e.start.dateTime);
    if (!(end > now)) continue;
    const others = (e.attendees ?? []).filter((a: any) => !a.self && !a.resource && a.email);
    return {
      title: String(e.summary ?? "Meeting"),
      startsInMin: Math.max(0, Math.round((start - now) / 60000)),
      attendees: others.map((a: any) => String(a.displayName || String(a.email).split("@")[0])),
      emails: others.map((a: any) => String(a.email)).filter((x: string) => EMAIL_RE.test(x)),
    };
  }
  return null;
}
