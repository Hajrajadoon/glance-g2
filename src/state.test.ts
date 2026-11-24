import test from "node:test";
import assert from "node:assert/strict";
import { initial, reduce, render, withDraft, currentCard, interpretVoice } from "./state.ts";
import { MOCK_CARDS } from "./mock.ts";

test("full happy path: reply to every card", () => {
  let s = initial(MOCK_CARDS);
  for (let i = 0; i < MOCK_CARDS.length; i++) {
    assert.equal(s.screen, "CARD");
    s = reduce(s, "TAP"); s = reduce(s, "TAP"); s = reduce(s, "TAP");
    assert.equal(s.screen, "SENT");
    s = reduce(s, "TAP");
  }
  assert.equal(s.screen, "EMPTY");
});

test("double tap goes back, nothing is sent", () => {
  let s = initial(MOCK_CARDS);
  s = reduce(s, "TAP"); s = reduce(s, "TAP");
  s = reduce(s, "DOUBLE_TAP");
  assert.equal(s.screen, "DRAFT");
  assert.equal(s.sent.length, 0);
});

test("swipe wraps around both directions", () => {
  let s = initial(MOCK_CARDS);
  s = reduce(s, "PREV");
  assert.equal(s.index, MOCK_CARDS.length - 1);
  s = reduce(s, "NEXT");
  assert.equal(s.index, 0);
});

test("every screen fits the display budget", () => {
  let s = initial(MOCK_CARDS);
  const screens = [s];
  for (const i of ["TAP", "TAP", "TAP"] as const) { s = reduce(s, i); screens.push(s); }
  for (const st of screens) {
    const text = render(st);
    assert.ok(text.length < 1000);
    assert.ok(text.split("\n").length <= 8, "too many lines: " + text);
    for (const line of text.split("\n")) assert.ok(line.length <= 34);
  }
});

test("empty inbox renders", () => {
  assert.match(render(initial([])), /Inbox zero/);
});

test("withDraft changes only the chosen card", () => {
  let s = initial(MOCK_CARDS);
  s = withDraft(s, "m1", "Short.");
  assert.equal(s.cards[0].draft, "Short.");
  assert.equal(s.cards[1].draft, MOCK_CARDS[1].draft);
  assert.equal(currentCard(s)?.id, "m1");
});

test("voice commands are understood", () => {
  assert.deepEqual(interpretVoice("Send it."), { kind: "send" });
  assert.deepEqual(interpretVoice("  skip "), { kind: "back" });
  assert.deepEqual(interpretVoice("say no politely"), { kind: "edit", instruction: "say no politely" });
  assert.deepEqual(interpretVoice("   "), { kind: "none" });
  assert.equal((interpretVoice("x".repeat(300)) as any).instruction.length, 100);
});

import { MOCK_BRIEF } from "./mock.ts";
test("double tap opens the meeting brief and any input returns", () => {
  let s = initial(MOCK_CARDS, MOCK_BRIEF);
  s = reduce(s, "DOUBLE_TAP");
  assert.equal(s.screen, "BRIEF");
  const text = render(s);
  assert.match(text, /Design review/);
  assert.ok(text.split("\n").length <= 8);
  for (const line of text.split("\n")) assert.ok(line.length <= 34, line);
  s = reduce(s, "TAP");
  assert.equal(s.screen, "CARD");
  assert.equal(s.index, 0);
});

test("without a brief, double tap on a card does nothing", () => {
  const s = reduce(initial(MOCK_CARDS), "DOUBLE_TAP");
  assert.equal(s.screen, "CARD");
});

test("brief is reachable from inbox zero and returns there", () => {
  let s = initial([], MOCK_BRIEF);
  assert.equal(s.screen, "EMPTY");
  s = reduce(s, "DOUBLE_TAP");
  assert.equal(s.screen, "BRIEF");
  s = reduce(s, "TAP");
  assert.equal(s.screen, "EMPTY");
  assert.ok(render(s).includes("2xTAP next meeting"));
});

test("card hint fits the display with a brief", () => {
  for (const line of render(initial(MOCK_CARDS, MOCK_BRIEF)).split("\n")) assert.ok(line.length <= 34, line);
});
