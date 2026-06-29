# Adore Salon AI Receptionist — Engineering Overview

An AI phone receptionist for Adore Salon. It answers calls, talks to callers in
natural language, looks up real services and prices, books/cancels/reschedules
appointments in the salon's booking system, and transfers to a human on request.

The project is written in **TypeScript** (compiled to `dist/` with `tsc`).

---

## 1. The big picture

```
 Caller's phone
      │  (PSTN call)
      ▼
 ┌──────────┐   audio    ┌───────────┐  text   ┌──────────────────────┐
 │  Twilio  │──────────▶ │ Deepgram  │───────▶ │  receptionist/       │
 │ (voice)  │  (stream)  │  (speech  │         │  (the "brain":       │
 │          │◀────────── │  to text) │         │  Claude + tools)     │
 └──────────┘  TwiML/    └───────────┘         └──────────┬───────────┘
   speaks      <Say>                                       │ tool calls
   reply                                                   ▼
                                              ┌────────────────────────┐
                                              │      booker-api/        │
                                              │ (Booker/Mindbody client)│
                                              └────────────────────────┘
```

The codebase is split into modules so the "what to say / what to do" logic is
independent of the phone plumbing:

| Module | Responsibility |
|--------|----------------|
| `receptionist/index.ts` | **Telephony + orchestration.** Twilio webhooks, the Deepgram audio stream, the per-turn Claude conversation loop, speaking replies. |
| `receptionist/receptionist-helpers.ts` | Turns data into text for the prompt: `describeCustomer`, `getAvailabilityBlock`, `formatDates`. |
| `receptionist/booker-helpers.ts` | The tool runner (`runBookingTool`), caller lookup (`resolveCaller`), and Booker-format datetime helpers (`buildSlotTimes`, `findStaffId`). |
| `app-constants/index.ts` | Tunable config: model, cache TTLs, port, business details, Deepgram settings. |
| `app-constants/claude.ts` | Everything the model reads: `SYSTEM_PROMPT` and the `BOOKING_TOOLS` definitions. |
| `booker-api/` | The Booker (Mindbody) API client — see §4. |
| `demo/index.ts` | Terminal demo that drives the same brain from a keyboard; saves a transcript. |

---

## 2. How a phone call flows, step by step

1. **Call comes in.** Twilio hits `POST /voice`. We answer with TwiML: a spoken
   greeting, then `<Connect><Stream>` to open a WebSocket back to our server,
   passing the caller's phone number as a parameter.
2. **Audio streams in.** Twilio sends the caller's audio (8kHz mulaw) over the
   WebSocket. We forward each chunk to Deepgram's live transcription.
3. **Speech → text.** Deepgram returns finalized transcripts. When the caller
   finishes a sentence, we have their text.
4. **The brain responds** (the loop in `receptionist/index.ts`):
   - Builds the system prompt = `SYSTEM_PROMPT` + cached **availability block** +
     the **caller's record** (if their phone number was recognized).
   - Calls Claude with the conversation history and the **booking tools**.
   - If Claude decides to use a tool (look up a service, book, etc.), we run it
     via `runBookingTool` → `booker-api`, feed the result back, and let Claude
     continue. This loops until Claude produces a final spoken reply.
5. **Speak the reply.** We update the live Twilio call with TwiML that speaks the
   reply, then reconnect the stream for the next turn. Conversation history is
   kept per call (`callSid`) so the AI remembers the whole conversation.
6. **Transfer.** If the caller explicitly asks for a human, the model returns
   `TRANSFER` and we `<Dial>` the human receptionist (`TRANSFER_NUMBER`).

The model is **Claude Haiku** (`MODEL` in `app-constants/index.ts`) — fast and
cheap enough for live, low-latency phone turns.

---

## 3. The tools the AI can call

Defined in `app-constants/claude.ts` (`BOOKING_TOOLS`), executed by
`runBookingTool` in `receptionist/booker-helpers.ts`:

| Tool | What it does | Booker call |
|------|--------------|-------------|
| `lookup_service` | Find a service's real name, price, duration. Handles fuzzy wording ("eyebrow wax" → "Waxing - Brows"). | `searchTreatments` |
| `check_availability` | List open times for a service on a date. | `searchAvailability` |
| `book_appointment` | Create the appointment (creates the customer if new). | `bookAppointment` |
| `cancel_appointment` | Cancel an existing appointment. | `cancelAppointment` |
| `reschedule_appointment` | Move an appointment to a new time. | `rescheduleAppointment` |

The system prompt forbids the model from quoting prices/services from memory — it
**must** call `lookup_service` first, so callers only ever hear real data.

---

## 4. The Booker integration (`booker-api/`)

Split into focused files, re-exported from `booker-api/index.ts`:

| File | Contents |
|------|----------|
| `api-client.ts` | Config from env, the two OAuth flows (customer + merchant), token caching, `fetchWithTimeout`. |
| `lookups.ts` | Reads: availability, treatments (services), **rooms**, appointments, customers. |
| `booking-actions.ts` | Writes: create customer, book, cancel, reschedule. |
| `response-normalizers.ts` | Normalize raw Booker objects into the shapes the app expects. |

Key points:
- **Auth.** Customer flow (`client_credentials`) for reads/booking; merchant flow
  (`personal_access_token`) for acting *as the business* (caller lookup, cancel,
  book-without-customer-login). Tokens cached until ~60s before expiry.
- **Booking** uses the merchant API (`createMerchantAppointment`) so a caller
  never has to log in — the right path for a receptionist.
- **Room lookup.** A Booker treatment can only be booked into a room that hosts
  it. `findRoomForTreatment`/`resolveRoomId` pick a supporting room per booking
  instead of one hardcoded default (a hardcoded room fails for every service it
  can't host — this was the cause of the "no available times / room not
  available" bug).

---

## 5. Running it

```bash
npm install
cp .env.example .env            # fill in keys

npm run build                   # compile TypeScript to dist/
npm start                       # the live phone server (needs Twilio+Deepgram)

npm run demo                    # terminal demo (builds, then runs); books real appts
npm run demo -- --from 9735551234   # simulate a recognized caller by phone
```

Every demo conversation is saved to `transcripts/adore-demo-<timestamp>.txt`.

---

## 6. Why the sandbox is limited — and why we can't read an employee's schedule

We are currently integrated against a **Booker staging/sandbox account
(location 3749)**, not Adore Salon's real production site. This matters in two
specific ways, and both are limits of the *account/environment*, not the code:

### a) Availability listing shows no times
`check_availability` (and Booker's own consumer booking page) returns **no open
times** for staff like Clori. The reason is that **availability is computed from
an employee's working-hours schedule**, and the staging account has **no staff
schedules configured**. With no shifts on the calendar, the availability engine
has nothing to offer — for every service.

Note that **booking still works** even when no times are listed: a direct
merchant booking only checks that a room is physically free at the requested
time, so it bypasses the schedule engine. That's why the demo can book a real
appointment (and Booker can see it) even though the "open times" list is empty.
Booking and availability use two different Booker subsystems.

### b) We cannot read or set an employee's schedule via the API
There is **no accessible schedule endpoint** for our integration on this account:

- Every employee-schedule endpoint we tried returns `404 Resource not found`.
  Employee **schedules are managed in the Booker web back-office UI**, not exposed
  to this API tier.
- The realtime-availability endpoint returns `401 "Not authorized for location"`
  for location 3749 — our subscription key isn't authorized for that API on the
  staging site.

So setting Clori's working hours (the thing that would make availability appear)
is a **back-office configuration task in Booker**, and reading those hours
programmatically isn't permitted at our current access level. Our app can still
**book, cancel, and reschedule** — those endpoints *are* authorized — it just
can't surface a live "open times" list until either (1) staff schedules are
configured on a real production site, and (2) our credentials are authorized for
the availability API on that site.

### What changes on the real Adore production account
- Real staff with real working hours → `check_availability` returns true open
  slots, and Booker's booking page shows times.
- Production credentials authorized for the availability API → the `401` and the
  `AvailableDates` timeouts go away.
- The per-treatment room lookup already in `booker-api/` carries over unchanged.
