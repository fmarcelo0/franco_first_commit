# Adore Salon — AI Phone Receptionist

An AI receptionist that answers Adore Salon's phone, talks to callers in natural
language, and looks up services, prices, availability, and books / cancels /
reschedules appointments in the salon's **Booker (Mindbody)** account — handing
off to a human when asked.

**Stack:** Twilio (voice) · Deepgram (speech-to-text) · Claude Haiku (AI) ·
Booker API (bookings) · **TypeScript** on Node.js + Express, hosted on Render.

## Quick start

```bash
npm install
cp .env.example .env     # fill in your keys (see comments in that file)
npm run build            # compile TypeScript to dist/
```

### Try the demo (no phone needed)

```bash
npm run demo                         # typed conversation; books real Booker appts
npm run demo -- --from 9735551234    # simulate a recognized caller by phone
```

Type as if you were the caller. Each conversation is saved to
`transcripts/adore-demo-<timestamp>.txt`. The demo needs `ANTHROPIC_API_KEY` and
the Booker credentials in `.env`. See **[docs/DEMO.md](docs/DEMO.md)** for how to
record a demo (footage + transcript) for Booker.

### Run the live phone server

```bash
npm start                # needs Twilio + Deepgram + Anthropic + Booker keys
```

Point your Twilio number's voice webhook at `POST /voice` on the deployed URL.

## How it works

A caller's audio flows Twilio → Deepgram (speech-to-text) → the AI "brain"
(`receptionist/`), which uses Claude with booking **tools** to answer and act via
the Booker client (`booker-api/`), then speaks the reply back through Twilio. The
demo drives the same brain from a keyboard.

See **[docs/ENGINEERING.md](docs/ENGINEERING.md)** for the full end-to-end
architecture, the tool list, and why the current Booker **sandbox** limits live
availability and employee-schedule access.

## Project layout

| Path | Role |
|------|------|
| `receptionist/` | The brain: phone server, conversation loop, tool runner, helpers |
| `booker-api/` | Booker/Mindbody API client (auth, services, rooms, booking) |
| `app-constants/` | Config (`index.ts`) and the model-facing prompt + tools (`claude.ts`) |
| `demo/` | Terminal demo + transcript capture |
| `docs/` | Engineering overview, demo guide, progress update |

## Scripts

| Command | Does |
|---------|------|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run typecheck` | Type-check without emitting |
| `npm start` | Run the live phone server (`dist/receptionist/index.js`) |
| `npm run demo` | Build, then run the terminal demo |
