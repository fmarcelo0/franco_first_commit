# Recording the Booker Demo

How to capture a live, recordable demo of the AI receptionist booking a **real**
appointment in the Booker account — with footage and a transcript to share.

## What you get
- **Footage:** a screen recording of a typed conversation where the assistant
  looks up real services and books a real appointment (visible afterward in the
  Booker calendar).
- **Transcript:** an exact text file auto-saved to
  `transcripts/adore-demo-<timestamp>.txt` — no speech-to-text errors, because
  the demo is typed.

This is the most reliable demo format: it exercises the same AI brain the phone
uses, hits the real Booker API, and produces a clean artifact every time.

## Prerequisites
1. `npm install` has been run.
2. `.env` contains `ANTHROPIC_API_KEY` **and** the Booker credentials (the same
   ones the phone app uses). See `.env.example`.
3. You're connected to the Booker account you want to demo against.

## Steps

1. **Start a screen recording** of your terminal window.
   On macOS: `Cmd + Shift + 5` → Record Selected Portion (or the whole screen),
   or QuickTime → File → New Screen Recording.

2. **Run the demo:**
   ```bash
   npm run demo
   ```
   To show caller recognition (the AI greets a returning client by name and can
   see their appointments), pass a phone number that exists in Booker:
   ```bash
   npm run demo -- --from 9735551234
   ```

3. **Have the conversation.** A strong, ~60-second script:
   - `how much is a gel manicure?`
     → the AI calls `lookup_service` and quotes the **real** price/duration.
   - `can I book one Friday at 2pm? my name is Sam Lee`
     → the AI books it and reads back a **real confirmation number**.
   - (optional) `actually can you move it to 3pm?` → reschedule.

4. **Show the proof.** Switch to the Booker calendar/dashboard and show the new
   appointment that just appeared. Pan slowly so it's clearly the same
   confirmation number.

5. **End the demo** with `Ctrl + C`. The transcript path is printed and the file
   is saved under `transcripts/`.

6. **Stop the screen recording.** You now have the footage + the transcript.

## What the transcript looks like
```
Adore Salon — AI Receptionist demo transcript
Date: ...
Mode: LIVE Booker (location 3749)
============================================================

Receptionist: Hello, thank you for calling Adore Salon. How can I help you today?

Caller: how much is a gel manicure?
[action: lookup_service({"service_name":"gel manicure"}) -> Gel Manicure — $40, 45 min]
Receptionist: A gel manicure is $40 and takes about 45 minutes.

Caller: book me one Friday at 2pm, my name is Sam Lee
[action: book_appointment({...}) -> Booked Gel Manicure ... Confirmation number 2413xxxxx.]
Receptionist: You're all set, Sam — booked for Friday at 2pm. Your confirmation number is 2413xxxxx.

[end of call]
```

## Important notes
- ⚠️ **Bookings are real.** Each `book_appointment` creates an actual appointment
  in the connected Booker account. To rehearse without leaving test data, book a
  far-future time and cancel it afterward (you can ask the assistant to cancel,
  or remove it in Booker).
- On the current **staging** account, the assistant may say it can't see specific
  open *times* (no staff schedules exist there — see `ENGINEERING.md`), but it
  **still completes the booking**. The confirmation number + the appointment
  appearing in Booker is the proof. On a real production account, live open times
  will also display.
- Transcripts are gitignored (`transcripts/`) and may contain customer names —
  share them deliberately.
