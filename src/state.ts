import type { Card, Brief } from "./mock.ts";

export type Screen = "CARD" | "DRAFT" | "CONFIRM" | "SENT" | "EMPTY" | "BRIEF";
export type Input = "TAP" | "DOUBLE_TAP" | "NEXT" | "PREV";

export type State = {
  cards: Card[];
  index: number;
  screen: Screen;
  sent: string[]; // ids already sent
  brief: Brief | null; // next meeting, if any
  from?: Screen; // where BRIEF returns to
};

export const COLS = 34; // characters per line on the display; tune on Day 1

export function initial(cards: Card[], brief: Brief | null = null): State {
  return { cards, index: 0, screen: cards.length ? "CARD" : "EMPTY", sent: [], brief };
}

function remaining(s: State): Card[] {
  return s.cards.filter((c) => !s.sent.includes(c.id));
}

/** Pure reducer: easy to test, no glasses needed. */
export function reduce(s: State, input: Input): State {
  const left = remaining(s);
  if (s.screen === "BRIEF") return { ...s, screen: s.from ?? (left.length ? "CARD" : "EMPTY"), from: undefined };
  if (s.screen === "EMPTY") return input === "DOUBLE_TAP" && s.brief ? { ...s, screen: "BRIEF", from: "EMPTY" } : s;

  if (s.screen === "SENT") {
    return left.length
      ? { ...s, screen: "CARD", index: Math.min(s.index, left.length - 1) }
      : { ...s, screen: "EMPTY", index: 0 };
  }

  if (s.screen === "CARD") {
    if (input === "NEXT") return { ...s, index: (s.index + 1) % left.length };
    if (input === "PREV") return { ...s, index: (s.index - 1 + left.length) % left.length };
    if (input === "TAP") return { ...s, screen: "DRAFT" };
    if (input === "DOUBLE_TAP" && s.brief) return { ...s, screen: "BRIEF", from: "CARD" };
    return s;
  }

  if (s.screen === "DRAFT") {
    if (input === "TAP") return { ...s, screen: "CONFIRM" };
    if (input === "DOUBLE_TAP") return { ...s, screen: "CARD" };
    return s;
  }

  // CONFIRM
  if (input === "TAP") {
    const card = left[s.index];
    return card ? { ...s, screen: "SENT", sent: [...s.sent, card.id] } : s;
  }
  if (input === "DOUBLE_TAP") return { ...s, screen: "DRAFT" };
  return s;
}

export function currentCard(s: State): Card | undefined {
  return remaining(s)[s.index];
}

/** Replace the draft of one card (used after an AI redraft). */
export function withDraft(s: State, id: string, draft: string): State {
  return { ...s, cards: s.cards.map((c) => (c.id === id ? { ...c, draft } : c)) };
}

export function wrap(text: string, cols = COLS): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (!line) line = word;
    else if ((line + " " + word).length <= cols) line += " " + word;
    else { out.push(line); line = word; }
  }
  if (line) out.push(line);
  return out;
}

const RULE = "-".repeat(COLS);

/** Turns state into the exact text shown on the glasses (kept well under 1000 chars). */
export function render(s: State): string {
  const left = remaining(s);
  const card = left[s.index];

  if (s.screen === "BRIEF" && s.brief) {
    const b = s.brief;
    return [
      `${b.title} ${b.when}`.slice(0, COLS),
      RULE,
      `With: ${b.who}`.slice(0, COLS),
      ...wrap(b.last).slice(0, 2),
      ...wrap(b.ask).slice(0, 2),
      "TAP back",
    ].join("\n");
  }
  if (s.screen === "EMPTY" || (!card && s.screen !== "SENT")) {
    return ["Inbox zero", RULE, "Nothing needs you.", "Enjoy the walk.", ...(s.brief ? ["", "2xTAP next meeting"] : [])].join("\n");
  }
  if (s.screen === "SENT") {
    const n = left.length;
    return ["Sent  [OK]", RULE, n ? `${n} more to go` : "All done!", "", "TAP continue"].join("\n");
  }
  const head = `${s.index + 1}/${left.length}  ${card.who}`.slice(0, COLS);

  if (s.screen === "CARD") {
    return [head, RULE, ...wrap(card.gist).slice(0, 3), "", (s.brief ? "TAP reply SWIPE next 2xTAP brief" : "TAP reply  SWIPE next")].join("\n");
  }
  if (s.screen === "DRAFT") {
    return [`Reply to ${card.who}`.slice(0, COLS), RULE, ...wrap(card.draft).slice(0, 4), "", "TAP send  SWIPE speak"].join("\n");
  }
  return ["Send this reply?", RULE, ...wrap(card.draft).slice(0, 3), "", "TAP yes  2xTAP no"].join("\n");
}

export type VoiceCommand =
  | { kind: "send" }
  | { kind: "back" }
  | { kind: "edit"; instruction: string }
  | { kind: "none" };

/** Turns what the user said (or typed) on the Draft screen into an action. Sending still needs a tap to confirm. */
export function interpretVoice(text: string): VoiceCommand {
  const t = text.toLowerCase().replace(/[^a-z' ]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return { kind: "none" };
  if (/^(send|send it|yes send|go ahead|confirm)( please)?$/.test(t)) return { kind: "send" };
  if (/^(back|skip|cancel|go back|never mind|nevermind)( please)?$/.test(t)) return { kind: "back" };
  return { kind: "edit", instruction: text.trim().slice(0, 100) };
}
