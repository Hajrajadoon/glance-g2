import type { Mail } from "./mails.ts";

export type CalEvent = { title: string; startsInMin: number; attendees: string[] };

// Demo calendar (Day 4 can replace this with Google Calendar). "startsInMin" keeps the demo always showing "soon".
export const MOCK_EVENT: CalEvent = {
  title: "Design review",
  startsInMin: 10,
  attendees: ["Sara Khan", "Ali Raza"],
};

/** Emails that mention an attendee (by sender name), newest relevant first as given. */
export function relatedMails(ev: CalEvent, mails: Mail[]): Mail[] {
  const names = ev.attendees.map((a) => a.toLowerCase().split(" ")[0]);
  return mails.filter((m) => names.some((n) => m.from.toLowerCase().includes(n)));
}
