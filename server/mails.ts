export type Mail = { id: string; from: string; subject: string; snippet: string };

// Demo inbox: a realistic mix of mails that need you and noise that doesn't.
export const RAW_MAILS: Mail[] = [
  { id: "e1", from: "Sara Khan <sara@studio.example>", subject: "Can we move Thursday's design review?", snippet: "Hi, something came up on Thursday. Could we do Friday morning instead? Let me know what works." },
  { id: "e2", from: "TechDaily <no-reply@techdaily.example>", subject: "Your weekly newsletter: 10 AI tools", snippet: "Top AI tools this week. Unsubscribe any time." },
  { id: "e3", from: "Ali Raza <ali@finance.example>", subject: "Invoice #2041 needs your approval today", snippet: "Please approve invoice #2041 for 1,200 USD so we can pay the vendor before end of day." },
  { id: "e4", from: "ShopNow <promo@shopnow.example>", subject: "50% sale ends tonight!", snippet: "Huge sale on all items. Shop now." },
  { id: "e5", from: "Maria, Acme Recruiting <maria@acme.example>", subject: "Quick intro call this week?", snippet: "I came across your profile and would love a 15-minute intro call. Are you free Wednesday or Thursday?" },
  { id: "e6", from: "GitHub <noreply@github.example>", subject: "[repo] CI passed on main", snippet: "All checks have passed." },
  { id: "e7", from: "Dad <dad@family.example>", subject: "Dinner on Friday?", snippet: "Mom is cooking biryani on Friday evening. Can you make it?" },
];
