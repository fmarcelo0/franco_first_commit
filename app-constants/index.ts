// Tunable configuration and shared constants for the AI receptionist.
// Kept in one place so behavior can be adjusted without hunting through the app.

// --- AI / Claude ---------------------------------------------------------
export const MODEL = 'claude-haiku-4-5-20251001'
export const MAX_TOKENS = 200

// --- Booking / datetime --------------------------------------------------
// Paris offset (CEST) — the datetime format Booker accepts.
export const TIMEZONE_OFFSET = '+02:00'
export const DEFAULT_DURATION_MIN = 30

// --- Caches (all in ms) --------------------------------------------------
export const AVAIL_TTL_MS = 5 * 60 * 1000          // availability block reuse window
export const CALLER_CACHE_TTL_MS = 5 * 60 * 1000   // per-phone caller lookup reuse
export const CONVERSATION_TTL_MS = 30 * 60 * 1000  // drop a call's history after this
export const PURGE_INTERVAL_MS = 10 * 60 * 1000    // how often stale calls are swept

// --- Server / telephony --------------------------------------------------
export const PORT = 8080
export const SPEECH_RATE = '115%'                  // <prosody rate> for spoken replies
export const TRANSFER_NUMBER = '+19739035245'      // human fallback when caller asks
// Public wss URL Twilio reconnects to between turns.
export const STREAM_URL = 'wss://franco-first-commit.onrender.com/stream'

// Deepgram live-transcription settings for an 8kHz mulaw phone stream.
export const DEEPGRAM_CONFIG = {
  model: 'nova-2-phonecall',
  language: 'en-US',
  smart_format: true,
  interim_results: false,
  endpointing: 500,
  encoding: 'mulaw',
  sample_rate: 8000
}

// --- Business details ----------------------------------------------------
export const BUSINESS = {
  name: 'Adore Salon',
  phone: '(973) 903-5245',
  address: '123 Main Street, Montclair, NJ 07042',
  // Real bookable Booker employee (Location 3749). "Aaron" = aaaaaaron aaaapple,
  // Clori (real) Marcelo performs every service in this test account, so she can
  // be booked for anything (and is the default employee).
  staff: [
    { employeeId: 643224, name: 'Clori' }
  ]
}
