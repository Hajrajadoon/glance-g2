<p align="center"><img src="docs/logo.svg" alt="Glance logo" width="96"></p>

# Glance: clear your inbox in 30 seconds, on your glasses

**Track 4: AI Assistants & Work** · Even G2 · Heads Up hackathon · [Landing page](https://hajrajadoon.github.io/glance-g2/)

Glance shows the few emails that need you, one per screen, with a reply already written. Tap to send, or say a short phrase to change it ("shorter", "say no politely"). Before a meeting, one double tap shows who you are meeting, the last thread with them and a question to ask.

> Walking to a meeting, you answer your email without taking out your phone.

## What it does
| Moment | What you see | What you do |
|---|---|---|
| Triage | Only emails that need a human (max 5). Newsletters, promotions and alerts are skipped. | Swipe to move between cards |
| Reply | An AI draft written from the email | **Click** to review, **Click** again, **Click** to send |
| Edit | The draft changes in seconds | Say or type: "shorter", "say no politely", "more friendly" |
| Meeting brief | Who, last thread, one question to ask | **Double click** on any card |

Every card ends in an action, and nothing is sent without the final tap.

## Controls
| Screen | Click | Double click | Up / Down |
|---|---|---|---|
| Card | open the draft | meeting brief | previous / next card |
| Draft | confirm screen | back | Up = "shorter", Down = speak a command |
| Confirm | **send** | back | - |

## How it works
```
Even G2 WebView app (TypeScript, Vite)  <->  Glance backend (Node, Express)  <->  Gmail API (read, send)
        text display, tap, mic                                              <->  Groq: Llama / GPT-OSS (triage, drafts, brief)
                                                                            <->  Groq Whisper (speech to text)
```
- **Sign in without a browser on the glasses:** Google sign-in does not work inside the WebView, so the glasses show a 6-digit pairing code. You type it on a normal web page (`/link`) and sign in with Google there.
- **Demo mode:** with no keys, or by tapping to skip the link screen, the app uses a built-in demo inbox. The demo never depends on a login.
- **Fallbacks everywhere:** if the AI is down or returns something unusable, simple built-in rules write the draft instead.

## Safety and privacy
- **No send without a tap.** Voice can open the confirm screen ("send it") but cannot send.
- **The glasses never choose the recipient.** The app only names a card. The server takes the address from the stored email, so a bad client cannot redirect a reply. No-reply addresses are refused and each reply can be sent only once.
- **Invented details are blocked.** Emails are treated as untrusted text for the AI. If a draft contains a name or number that is not in the email, or ignores your instruction, it is discarded and replaced by a safe built-in reply.
- **Minimal data.** Only the Gmail read and send permissions are requested. Emails are never stored. Tokens live in server memory only. API keys stay on the backend and never ship inside the app.

## Run it
Requirements: Node.js 20 LTS or 22+.
```bash
npm install -g @evenrealities/evenhub-cli @evenrealities/evenhub-simulator
npm install
npm test                 # 39 tests
copy .env.example .env   # Windows. On Mac/Linux use: cp .env.example .env
npm run server           # terminal 1 -> http://localhost:8787
npm run dev              # terminal 2
npm run sim              # terminal 3: opens the G2 simulator
```
Without any keys it runs in OFFLINE mode on the demo inbox.

### Free AI and voice (Groq)
Create a free key at console.groq.com/keys and set `GROQ_API_KEY` in `.env`. It powers the AI drafts and Whisper speech to text. If a model is not available on your account, the server tries the next one automatically. Typed commands work without a microphone: use the box on the app page.

### Real Gmail (optional)
1. Google Cloud Console: create a project and enable the **Gmail API**.
2. Google Auth Platform: External app, add the scopes `gmail.readonly` and `gmail.send`, and add your Gmail as a **test user**.
3. Credentials: create an **OAuth client ID** (Web application) with the redirect URI `http://localhost:8787/auth/callback`.
4. Put `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env` and restart the server. It prints `Gmail : ready`.
5. Start the app. The glasses show a code. Open `http://localhost:8787/link`, enter it and sign in. Google shows an "unverified app" notice in Testing mode: choose Advanced, then continue.

Tap on the glasses at the link screen to use the demo inbox instead.

### Optional: Google Calendar brief
Enable the Calendar API, add `calendar.readonly`, and set `GOOGLE_CALENDAR=1`. Without it, the brief shows demo data in demo mode and is hidden for linked accounts.

### Package for Even Hub
```bash
npm run build
npm run pack             # writes glance.ehpk
```
Set `VITE_API_URL` and the `network` whitelist in `app.json` to your hosted backend before running it on real glasses.

## Project layout
```
src/       glasses app: screens and state machine (state.ts), SDK adapter (glasses.ts), API client, main
server/    backend: Gmail and Calendar client, sessions, AI providers, safety checks
```
All Even Hub SDK calls are in one file, `src/glasses.ts`. The rest is plain, tested TypeScript.

## Built during the hackathon
Everything in this repository was written from Nov 23, 2026. Existing pieces used: the Even Hub SDK, simulator and CLI, Vite, Express, the Anthropic SDK (optional provider), and the Gmail and Groq APIs.

Tested in the Even Hub simulator. Not yet tested on physical G2 hardware.
