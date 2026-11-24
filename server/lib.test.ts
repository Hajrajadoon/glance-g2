import test from "node:test";
import assert from "node:assert/strict";
import { extractJSON, clampCards, sanitizeMails, offlineTriage, offlineRedraft } from "./lib.ts";
import { RAW_MAILS } from "./mails.ts";

test("extractJSON handles code fences and chatter", () => {
  assert.deepEqual(extractJSON('Sure!\n```json\n{"a":1}\n```'), { a: 1 });
  assert.throws(() => extractJSON("no json here"));
});

test("clampCards drops fake ids, duplicates, empties and trims lengths", () => {
  const mails = sanitizeMails(RAW_MAILS);
  const raw = { cards: [
    { id: "e1", who: "x".repeat(99), gist: "g", draft: "d" },
    { id: "e1", who: "dup", gist: "g", draft: "d" },
    { id: "FAKE", who: "a", gist: "b", draft: "c" },
    { id: "e3", who: "", gist: "b", draft: "c" },
  ] };
  const out = clampCards(raw, mails);
  assert.equal(out.length, 1);
  assert.equal(out[0].who.length, 20);
});

test("clampCards survives garbage", () => {
  assert.deepEqual(clampCards(null, []), []);
  assert.deepEqual(clampCards({ cards: "nope" }, []), []);
});

test("offline triage skips noise and keeps real mails", () => {
  const cards = offlineTriage(sanitizeMails(RAW_MAILS));
  assert.deepEqual(cards.map((c) => c.id), ["e1", "e3", "e5", "e7"]);
  for (const c of cards) assert.ok(c.who.length <= 20 && c.gist.length <= 60);
});

test("offline redraft shortens and warms", () => {
  const d = "Sure, Friday 10am works for me. I'll update the invite. Thanks!";
  assert.equal(offlineRedraft(d, "make it shorter"), "Sure, Friday 10am works for me.");
  assert.match(offlineRedraft(d, "more polite"), /^Thank you so much/);
});

test("sanitizeMails caps count and removes id-less rows", () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ id: "m" + i, from: "a", subject: "s", snippet: "x" }));
  assert.equal(sanitizeMails(many).length, 25);
  assert.equal(sanitizeMails([{ from: "a" }]).length, 0);
});

import { clampBrief, offlineBrief } from "./lib.ts";
import { MOCK_EVENT, relatedMails } from "./calendar.ts";

test("offline brief uses the attendee's latest email", () => {
  const related = relatedMails(MOCK_EVENT, sanitizeMails(RAW_MAILS));
  assert.ok(related.length >= 2);
  const b = offlineBrief(MOCK_EVENT, related);
  assert.equal(b.when, "in 10m");
  assert.equal(b.who, "Sara, Ali");
  assert.match(b.last, /^Sara:/);
  assert.ok(b.last.length <= 64 && b.title.length <= 22);
});

test("offline brief copes with no related mail", () => {
  assert.match(offlineBrief(MOCK_EVENT, []).last, /No recent emails/);
});

test("clampBrief trims, fills blanks, and never lets the model set the time", () => {
  const fb = offlineBrief(MOCK_EVENT, []);
  const b = clampBrief({ title: "x".repeat(80), when: "in 99m", who: "", last: "L", ask: "A" }, fb);
  assert.equal(b.title.length, 22);
  assert.equal(b.when, "in 10m");
  assert.equal(b.who, fb.who);
  assert.deepEqual(clampBrief(null, fb), fb);
});

import { looksInvented, redraftOk, offlineDraft } from "./lib.ts";

test("looksInvented catches made-up names and numbers but allows words from the email", () => {
  const src = "Sara Khan: Can we move Thursday's design review? Hi Sara, Friday 10am works.";
  assert.equal(looksInvented("Sure, Friday morning works for me. See now, Paul Hartley.", src), true);
  assert.equal(looksInvented("I have a meeting at 4 on Friday.", src), true);
  assert.equal(looksInvented("Hi Sara, Thursday works for me. Thanks!", src), false);
  assert.equal(looksInvented("Sounds good. Let me check and get back to you.", src), false);
});

test("redraftOk rejects the exact bad answer from testing and accepts a proper decline", () => {
  const o = { original: "Sara Khan: Can we move Thursday's design review?", draft: "Sure, Friday 10am works for me.", instruction: "say no politely" };
  assert.equal(redraftOk("Sure, Friday morning works for me. See now, Paul Hartley.", o), false);
  assert.equal(redraftOk("Thanks for asking, but that won't work for me this time.", o), true);
  assert.equal(redraftOk("", o), false);
});

test("redraftOk enforces 'shorter' and never accepts a longer draft", () => {
  const o = { original: "x", draft: "Sure, that works for me. Let's lock it in.", instruction: "make it shorter" };
  assert.equal(redraftOk("Sure, that works.", o), true);
  assert.equal(redraftOk("Sure, that works for me and I am happy to lock it in right now.", o), false);
});

test("clampCards swaps an AI draft that invents a name for a safe one", () => {
  const mails = sanitizeMails(RAW_MAILS);
  const out = clampCards({ cards: [{ id: "e1", who: "Sara Khan", gist: "Move review", draft: "Sure, works for me. Regards, Paul Hartley." }] }, mails);
  assert.equal(out[0].draft, offlineDraft(mails[0]));
});
