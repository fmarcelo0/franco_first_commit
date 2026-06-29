// Tunable configuration and shared constants for the AI receptionist.
// Kept in one place so behavior can be adjusted without hunting through the app.

// --- AI / Claude ---------------------------------------------------------
const MODEL = 'claude-haiku-4-5-20251001'
const MAX_TOKENS = 200

// --- Booking / datetime --------------------------------------------------
// Paris offset (CEST) — the datetime format Booker accepts.
const TIMEZONE_OFFSET = '+02:00'
const DEFAULT_DURATION_MIN = 30

// --- Caches (all in ms) --------------------------------------------------
const AVAIL_TTL_MS = 5 * 60 * 1000          // availability block reuse window
const CALLER_CACHE_TTL_MS = 5 * 60 * 1000   // per-phone caller lookup reuse
const CONVERSATION_TTL_MS = 30 * 60 * 1000  // drop a call's history after this
const PURGE_INTERVAL_MS = 10 * 60 * 1000    // how often stale calls are swept

// --- Server / telephony --------------------------------------------------
const PORT = 8080
const SPEECH_RATE = '115%'                  // <prosody rate> for spoken replies
const TRANSFER_NUMBER = '+19739035245'      // human fallback when caller asks
// Public wss URL Twilio reconnects to between turns.
const STREAM_URL = 'wss://franco-first-commit.onrender.com/stream'

// Deepgram live-transcription settings for an 8kHz mulaw phone stream.
const DEEPGRAM_CONFIG = {
  model: 'nova-2-phonecall',
  language: 'en-US',
  smart_format: true,
  interim_results: false,
  endpointing: 500,
  encoding: 'mulaw',
  sample_rate: 8000
}

// --- Business details ----------------------------------------------------
const BUSINESS = {
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

// Tools the AI can call during a live call to look up services and book
// appointments in the real Booker/Mindbody account.
const BOOKING_TOOLS = [
  {
    name: 'lookup_service',
    description: 'Look up a salon service by name to get its real price and duration before booking.',
    input_schema: {
      type: 'object',
      properties: {
        service_name: { type: 'string', description: 'e.g. "waxing", "massage"' }
      },
      required: ['service_name']
    }
  },
  {
    name: 'check_availability',
    description: 'Check what times are open for a service on a given date.',
    input_schema: {
      type: 'object',
      properties: {
        service_name: { type: 'string', description: 'the service to check' },
        date: { type: 'string', description: 'date as YYYY-MM-DD' }
      },
      required: ['service_name', 'date']
    }
  },
  {
    name: 'book_appointment',
    description: "Book an appointment for the caller. Look up the service first if you don't have it.",
    input_schema: {
      type: 'object',
      properties: {
        firstname: { type: 'string' },
        lastname: { type: 'string' },
        service_name: { type: 'string', description: 'the service to book' },
        date: { type: 'string', description: 'appointment date as YYYY-MM-DD' },
        time: { type: 'string', description: 'start time as HH:MM, 24-hour' },
        employee: { type: 'string', description: 'optional: a specific staff member the caller requested' }
      },
      required: ['firstname', 'lastname', 'service_name', 'date', 'time']
    }
  },
  {
    name: 'cancel_appointment',
    description: "Cancel one of the caller's existing appointments (use the appointment number from their record).",
    input_schema: {
      type: 'object',
      properties: {
        appointment_id: { type: 'number', description: 'the appointment number to cancel' }
      },
      required: ['appointment_id']
    }
  },
  {
    name: 'reschedule_appointment',
    description: "Move one of the caller's existing appointments to a new date and time.",
    input_schema: {
      type: 'object',
      properties: {
        appointment_id: { type: 'number', description: 'the appointment number to move' },
        new_date: { type: 'string', description: 'new date as YYYY-MM-DD' },
        new_time: { type: 'string', description: 'new start time as HH:MM, 24-hour' }
      },
      required: ['appointment_id', 'new_date', 'new_time']
    }
  }
]

module.exports = {
  MODEL,
  MAX_TOKENS,
  BOOKING_TOOLS,
  TIMEZONE_OFFSET,
  DEFAULT_DURATION_MIN,
  AVAIL_TTL_MS,
  CALLER_CACHE_TTL_MS,
  CONVERSATION_TTL_MS,
  PURGE_INTERVAL_MS,
  PORT,
  SPEECH_RATE,
  TRANSFER_NUMBER,
  STREAM_URL,
  DEEPGRAM_CONFIG,
  BUSINESS
}
