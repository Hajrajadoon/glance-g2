# Submission text (paste into the form)

**Project name:** Glance

**Track:** 04 · AI Assistants & Work (Gmail)

**One line:** Clear your inbox in 30 seconds on your glasses: one email at a time, an AI-written reply, send with a tap or change it by voice.

## Description
**Problem.** Email pulls you out of the moment. Checking your inbox on the way to a meeting means taking out your phone, scrolling past newsletters and typing replies with your thumbs.

**Who it is for.** Busy professionals, managers and founders who get dozens of emails a day, and anyone who wants to stay present while still replying quickly.

**How it works.** Glance reads your unread Gmail and uses AI to pick the few emails that need a human (max 5), skipping newsletters, promotions and alerts. Each one appears on the G2 as a short card: who, and what they want. A reply is already written. One tap opens it, another confirms, a third sends it through Gmail. To change the draft you say a short phrase, such as "shorter" or "say no politely", and it is rewritten in seconds. A double tap shows a three-line brief for your next meeting: who is in it, the last email thread with them and a question to ask.

**Read and write.** Every card ends in an action: send, edit by voice, skip. Writing is never long dictation: it is a tap or one short phrase, with AI drafts and smart defaults.

**Safety.** Nothing is sent without the final tap. The glasses cannot choose the recipient (the server takes it from the stored email), no-reply addresses are refused, and each reply can be sent only once. Drafts that invent names or numbers not found in the email are discarded. Only Gmail read and send permissions are requested, emails are never stored and API keys stay on the backend.

**Business potential.** Email is the highest-volume work channel and the one people check most on the move. Glance can grow into a daily glanceable assistant for any inbox (Outlook, Slack, Calendar actions) and into a paid productivity tier for professionals.

**Tech.** TypeScript web app for the Even Hub WebView, Node/Express backend, Gmail API with a pairing-code sign-in (Google sign-in does not work in the WebView), Groq-hosted LLMs for triage and drafts, Whisper for speech to text. 39 automated tests. Demo mode and rule-based fallbacks keep it working with no keys or if the AI is down.

## Links
- Repository: (paste your public GitHub link)
- Demo video: (paste your video link, up to 3 minutes)

## Before you submit
- [ ] Repository is public and the README renders.
- [ ] `.env` is not in the repository.
- [ ] Video is 3:00 or shorter and shows no keys, no personal emails.
- [ ] Submitted before Nov 29, 23:59 Dubai time (Nov 30, 00:59 Pakistan time). Aim for the afternoon of Nov 29.
