export type Card = {
  id: string;
  who: string;   // max ~20 chars
  gist: string;  // max ~60 chars
  draft: string; // reply under 40 words
};

// Demo mode: works with no backend and no login. Your video never depends on OAuth.
export const MOCK_CARDS: Card[] = [
  { id: "m1", who: "Sara Khan", gist: "Can we move Thursday's design review?", draft: "Sure, Friday 10am works for me. I'll update the invite. Thanks!" },
  { id: "m2", who: "Ali (Finance)", gist: "Invoice #2041 needs your approval today.", draft: "Approved. Please process it today and send me the receipt." },
  { id: "m3", who: "Recruiter, Acme", gist: "Interested in a 15-min intro call this week?", draft: "Thanks for reaching out. I'm not looking right now, but I'll keep in touch." },
];

export type Brief = { title: string; when: string; who: string; last: string; ask: string };

export const MOCK_BRIEF: Brief = {
  title: "Design review",
  when: "in 10m",
  who: "Sara, Ali",
  last: "Sara: move Thursday review?",
  ask: "Ask: is Friday 10am confirmed?",
};
