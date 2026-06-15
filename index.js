require('dotenv').config()
const express = require('express')
const Anthropic = require('@anthropic-ai/sdk')
const { createClient, LiveTranscriptionEvents } = require('@deepgram/sdk')
const WebSocket = require('ws')
const http = require('http')
const twilio = require('twilio')
const booker = require('./booker')

const app = express()
app.use(express.urlencoded({ extended: false }))

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const deepgramClient = createClient(process.env.DEEPGRAM_API_KEY)
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)

const MOCK_BUSINESS = {
  locationId: 12345,
  name: 'Adore Salon',
  phone: '(973) 903-5245',
  address: '123 Main Street, Montclair, NJ 07042',
  hours: {
    Monday: '9:00 AM - 7:00 PM',
    Tuesday: '9:00 AM - 7:00 PM',
    Wednesday: '9:00 AM - 7:00 PM',
    Thursday: '9:00 AM - 7:00 PM',
    Friday: '9:00 AM - 7:00 PM',
    Saturday: '9:00 AM - 7:00 PM',
    Sunday: '10:00 AM - 5:00 PM'
  },
  startTimeInterval: 15,
  serviceCategories: [
    {
      serviceCategoryId: 1,
      serviceCategoryName: 'Nails',
      services: [
        { serviceId: 101, serviceName: 'Classic Manicure', duration: 30, price: 25 },
        { serviceId: 102, serviceName: 'Gel Manicure', duration: 45, price: 35 },
        { serviceId: 103, serviceName: 'Classic Pedicure', duration: 60, price: 45 },
        { serviceId: 104, serviceName: 'Gel Pedicure', duration: 75, price: 55 },
        { serviceId: 105, serviceName: 'Mani-Pedi Combo', duration: 90, price: 65 }
      ]
    },
    {
      serviceCategoryId: 2,
      serviceCategoryName: 'Waxing',
      services: [
        { serviceId: 201, serviceName: 'Eyebrow Wax', duration: 15, price: 15 },
        { serviceId: 202, serviceName: 'Upper Lip Wax', duration: 10, price: 10 },
        { serviceId: 203, serviceName: 'Full Leg Wax', duration: 45, price: 65 },
        { serviceId: 204, serviceName: 'Bikini Wax', duration: 30, price: 45 },
        { serviceId: 205, serviceName: 'Full Body Wax', duration: 90, price: 120 }
      ]
    },
    {
      serviceCategoryId: 3,
      serviceCategoryName: 'Hair',
      services: [
        { serviceId: 301, serviceName: "Women's Haircut", duration: 60, price: 65 },
        { serviceId: 302, serviceName: "Men's Haircut", duration: 30, price: 35 },
        { serviceId: 303, serviceName: 'Blowout', duration: 45, price: 45 },
        { serviceId: 304, serviceName: 'Color & Cut', duration: 120, price: 145 },
        { serviceId: 305, serviceName: 'Highlights', duration: 90, price: 115 }
      ]
    },
    {
      serviceCategoryId: 4,
      serviceCategoryName: 'Massage',
      services: [
        { serviceId: 401, serviceName: 'Swedish Massage (30 min)', duration: 30, price: 55 },
        { serviceId: 402, serviceName: 'Swedish Massage (60 min)', duration: 60, price: 90 },
        { serviceId: 403, serviceName: 'Deep Tissue Massage (60 min)', duration: 60, price: 105 },
        { serviceId: 404, serviceName: 'Hot Stone Massage (60 min)', duration: 60, price: 115 }
      ]
    }
  ],
  availableDates: [
    '2026-06-02T00:00:00-04:00',
    '2026-06-03T00:00:00-04:00',
    '2026-06-04T00:00:00-04:00',
    '2026-06-05T00:00:00-04:00',
    '2026-06-06T00:00:00-04:00',
    '2026-06-07T00:00:00-04:00',
    '2026-06-08T00:00:00-04:00'
  ],
  sampleTimeSlots: [
    '9:00 AM', '9:15 AM', '9:30 AM', '9:45 AM',
    '10:00 AM', '10:15 AM', '10:30 AM', '10:45 AM',
    '11:00 AM', '11:15 AM', '11:30 AM', '11:45 AM',
    '12:00 PM', '12:15 PM', '12:30 PM', '12:45 PM',
    '1:00 PM', '1:15 PM', '1:30 PM', '1:45 PM',
    '2:00 PM', '2:15 PM', '2:30 PM', '2:45 PM',
    '3:00 PM', '3:15 PM', '3:30 PM', '3:45 PM',
    '4:00 PM', '4:15 PM', '4:30 PM', '4:45 PM',
    '5:00 PM', '5:15 PM', '5:30 PM'
  ],
  // Real Booker employees (Location 3749), so staff names match what's bookable.
  staff: [
    { employeeId: 641609, name: 'Auden' },
    { employeeId: 641869, name: 'Kane' },
    { employeeId: 639558, name: 'Shareef' }
  ]
}

function buildServiceMenu() {
  return MOCK_BUSINESS.serviceCategories.map(cat =>
    `${cat.serviceCategoryName}: ${cat.services.map(s => `${s.serviceName} (${s.duration} min, $${s.price})`).join(', ')}`
  ).join('\n')
}

function formatDates(isoDates) {
  return isoDates.map(d =>
    new Date(d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  ).join(', ')
}

function buildAvailableDates() {
  return formatDates(MOCK_BUSINESS.availableDates)
}

// Live availability from Booker when configured; mock data otherwise.
// Returns a text block to append to the system prompt for the call.
async function getAvailabilityBlock() {
  if (booker.isConfigured()) {
    try {
      const dates = await booker.getAvailableDates()
      return `AVAILABLE APPOINTMENT DATES (live from Booker):
${dates.length ? formatDates(dates) : 'No open dates in the next two weeks.'}`
    } catch (err) {
      console.error('Booker availability lookup failed, using mock:', err.message)
    }
  }
  return `AVAILABLE APPOINTMENT DATES THIS WEEK:
${buildAvailableDates()}

AVAILABLE TIME SLOTS (most days):
${MOCK_BUSINESS.sampleTimeSlots.join(', ')}`
}

// Identify the caller by phone: live via Booker Merchant FindCustomers when
// configured, mock customer records otherwise.
async function resolveCaller(phone) {
  if (booker.isMerchantConfigured()) {
    try {
      const live = await booker.lookupCustomerByPhone(phone)
      if (live) return live
    } catch (err) {
      console.error('Booker customer lookup failed, using mock:', err.message)
    }
  }
  return findCustomerByPhone(phone)
}

// Mock customer records — mirrors what Booker's FindCustomers + FindAppointments
// would return. Each has a Booker-style numeric customerId and appointmentId.
const MOCK_CUSTOMERS = [
  {
    customerId: 90001,
    firstName: 'Maria',
    lastName: 'Gonzalez',
    phone: '+19735551234',
    email: 'maria.gonzalez@example.com',
    appointments: [
      {
        appointmentId: 500123,
        serviceName: 'Gel Manicure',
        employeeName: 'Jessica',
        startDateTime: '2026-06-05T14:00:00-04:00',
        status: 'Booked'
      }
    ]
  },
  {
    customerId: 90002,
    firstName: 'James',
    lastName: 'Carter',
    phone: '+19735555678',
    email: 'james.carter@example.com',
    appointments: [
      {
        appointmentId: 500124,
        serviceName: "Men's Haircut",
        employeeName: 'Priya',
        startDateTime: '2026-06-04T10:30:00-04:00',
        status: 'Booked'
      },
      {
        appointmentId: 500125,
        serviceName: 'Deep Tissue Massage (60 min)',
        employeeName: 'Ashley',
        startDateTime: '2026-06-07T16:00:00-04:00',
        status: 'Booked'
      }
    ]
  },
  {
    customerId: 90003,
    firstName: 'Lin',
    lastName: 'Nguyen',
    phone: '+19735559012',
    email: 'lin.nguyen@example.com',
    appointments: []
  }
]

// Keep only the last 10 digits so +1 (973) 555-1234 and 9735551234 match.
function normalizePhone(p) {
  return (p || '').replace(/\D/g, '').slice(-10)
}

function findCustomerByPhone(phone) {
  const norm = normalizePhone(phone)
  if (!norm) return null
  return MOCK_CUSTOMERS.find(c => normalizePhone(c.phone) === norm) || null
}

function describeCustomer(c) {
  const appts = c.appointments.length
    ? c.appointments.map(a => {
        const when = new Date(a.startDateTime).toLocaleString('en-US', {
          weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit'
        })
        return `- ${a.serviceName} with ${a.employeeName} on ${when} (appointment #${a.appointmentId}, ${a.status})`
      }).join('\n')
    : '- No upcoming appointments on file.'
  return `Name: ${c.firstName} ${c.lastName} (customer #${c.customerId})
Phone on file: ${c.phone}
Upcoming appointments:
${appts}`
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
  }
]

// Map a requested staff name to a real Booker employee ID (undefined if none).
function findStaffId(requested) {
  if (!requested) return undefined
  const q = requested.toLowerCase().trim()
  const match = MOCK_BUSINESS.staff.find(s => s.name.toLowerCase() === q) ||
                MOCK_BUSINESS.staff.find(s => s.name.toLowerCase().includes(q))
  return match && match.employeeId
}

async function runBookingTool(name, input, ctx = {}) {
  if (name === 'lookup_service') {
    const matches = await booker.searchTreatments(input.service_name)
    if (!matches.length) return 'No matching service found.'
    return matches.map(m => `${m.name} — $${m.price}, ${m.duration} min`).join('; ')
  }
  if (name === 'book_appointment') {
    const matches = await booker.searchTreatments(input.service_name)
    if (!matches.length) return `Sorry, I couldn't find a service matching "${input.service_name}".`
    const svc = matches[0]
    // Build start/end in Paris offset (CEST, +02:00) — the format Booker accepts.
    const pad = n => String(n).padStart(2, '0')
    const [h, m] = input.time.split(':').map(Number)
    const endMin = h * 60 + m + (svc.duration || 30)
    const startDateTime = `${input.date}T${pad(h)}:${pad(m)}:00+02:00`
    const endDateTime = `${input.date}T${pad(Math.floor(endMin / 60))}:${pad(endMin % 60)}:00+02:00`
    try {
      const res = await booker.bookAppointment({
        firstName: input.firstname,
        lastName: input.lastname,
        phone: ctx.callerPhone,
        treatmentId: svc.treatmentId,
        employeeId: findStaffId(input.employee),  // undefined -> default employee
        startDateTime,
        endDateTime
      })
      if (res.IsSuccess) {
        const id = res.Appointment && res.Appointment.ID
        return `Booked ${svc.name} on ${input.date} at ${input.time}.${id ? ' Confirmation number ' + id + '.' : ''}`
      }
      return `Could not book: ${res.ErrorMessage || 'unknown error'}`
    } catch (e) {
      return `Booking error: ${e.message}`
    }
  }
  return 'Unknown tool.'
}

const SYSTEM_PROMPT = `You are a friendly receptionist for ${MOCK_BUSINESS.name}.
You help callers with questions about hours, pricing, services, staff, and appointment availability.
Keep responses short and conversational — this is a phone call, 1-2 sentences max.

BUSINESS INFO:
- Address: ${MOCK_BUSINESS.address}
- Phone: ${MOCK_BUSINESS.phone}
- Hours: Monday-Saturday 9am-7pm, Sunday 10am-5pm

SERVICES & PRICING:
${buildServiceMenu()}

STAFF:
${MOCK_BUSINESS.staff.map(s => s.name).join(', ')}

BOOKING & APPOINTMENTS:
You can look up real services and book appointments using your tools.
- Use lookup_service to confirm a service's real price and duration.
- To book, collect the caller's first name, last name, the service, a date (YYYY-MM-DD) and a time (HH:MM), then use book_appointment.
- If the caller requests a specific staff member (${MOCK_BUSINESS.staff.map(s => s.name).join(', ')}), pass it as the employee. Otherwise leave it blank and we'll assign someone.
- If the booking comes back as not available, tell the caller and offer a different time.
- After a successful booking, read the confirmation number back to the caller.
Ask for any missing detail before booking. Today's date is ${new Date().toISOString().slice(0, 10)}.

CALLER IDENTIFICATION:
We usually recognize callers by the phone number they are calling from. If a "CALLER ON THE LINE" section is provided below, you already know who they are and what appointments they have — greet them by their first name and answer questions about "my appointment" directly from that info. Do NOT ask them to identify themselves again. If they ask to cancel or change an appointment, confirm the details back to them and let them know a staff member will finalize the change. If NO caller section is provided, politely ask for their first and last name and the phone number on their account so it can be looked up.

If the caller asks to speak to a human or you cannot answer their question, respond with exactly the word TRANSFER and nothing else.`

app.get('/', (req, res) => res.send('Adore Salon AI Receptionist is running'))

app.post('/voice', (req, res) => {
  const from = req.body.From || ''
  res.type('text/xml')
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Say><prosody rate="115%">Hello, thank you for calling Adore Salon. How can I help you today?</prosody></Say>
      <Connect>
        <Stream url="wss://${req.headers.host}/stream">
          <Parameter name="from" value="${from}" />
        </Stream>
      </Connect>
    </Response>
  `)
})

// Conversation history per call, keyed by Twilio callSid. Persists across the
// stream reconnect that happens between turns, so the AI remembers the whole
// conversation instead of just the latest sentence.
const conversations = new Map()

// Purge stale conversations periodically so the map doesn't grow forever.
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000
  for (const [sid, c] of conversations) {
    if (c.ts < cutoff) conversations.delete(sid)
  }
}, 10 * 60 * 1000).unref()

const server = http.createServer(app)
const wss = new WebSocket.Server({ server, path: '/stream' })

wss.on('connection', (ws) => {
  let callSid = null
  let callerPhone = null
  let isSpeaking = false
  let availabilityBlock = null  // fetched once per call, then reused
  let caller = null             // resolved once per call (live or mock)
  let callerResolved = false


  const dgConnection = deepgramClient.listen.live({
    model: 'nova-2-phonecall',
    language: 'en-US',
    smart_format: true,
    interim_results: false,
    endpointing: 500,
    encoding: 'mulaw',
    sample_rate: 8000
  })

  dgConnection.on(LiveTranscriptionEvents.Transcript, async (data) => {
    const text = data.channel?.alternatives[0]?.transcript
    if (!text || !data.is_final || isSpeaking) return

    console.log('Caller:', text)
    isSpeaking = true

    try {
      if (availabilityBlock === null) availabilityBlock = await getAvailabilityBlock()
      if (!callerResolved) { caller = await resolveCaller(callerPhone); callerResolved = true }

      const customerSection = caller ? `\n\nCALLER ON THE LINE:\n${describeCustomer(caller)}` : ''
      const systemPrompt = `${SYSTEM_PROMPT}\n\n${availabilityBlock}${customerSection}`

      const prior = conversations.get(callSid)
      const messages = [...(prior ? prior.messages : []), { role: 'user', content: text }]
      let response = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        system: systemPrompt,
        tools: BOOKING_TOOLS,
        messages
      })

      // Let the AI call tools (lookup/booking) before its final spoken reply.
      while (response.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: response.content })
        const toolResults = []
        for (const block of response.content) {
          if (block.type !== 'tool_use') continue
          console.log('Tool:', block.name, JSON.stringify(block.input))
          let result
          try {
            result = await runBookingTool(block.name, block.input, { callerPhone })
          } catch (e) {
            result = `Error: ${e.message}`
          }
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: String(result) })
        }
        messages.push({ role: 'user', content: toolResults })
        response = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 200,
          system: systemPrompt,
          tools: BOOKING_TOOLS,
          messages
        })
      }

      // Remember this turn so the AI has context for the caller's next sentence.
      messages.push({ role: 'assistant', content: response.content })
      conversations.set(callSid, { messages, ts: Date.now() })

      const reply = (response.content.find(b => b.type === 'text') || {}).text || ''
      console.log('AI:', reply)

      if (reply.includes('TRANSFER')) {
        await twilioClient.calls(callSid).update({
          twiml: `<Response><Say>Please hold while I transfer you.</Say><Dial>+19739035245</Dial></Response>`
        })
        return
      }

      await twilioClient.calls(callSid).update({
        twiml: `<Response><Say><prosody rate="115%">${reply}</prosody></Say><Connect><Stream url="wss://franco-first-commit.onrender.com/stream"><Parameter name="from" value="${callerPhone || ''}"/></Stream></Connect></Response>`
      })
    } catch (err) {
      console.error(err)
    } finally {
      isSpeaking = false
    }
  })

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data)
      if (msg.event === 'start') {
        callSid = msg.start.callSid
        callerPhone = msg.start.customParameters?.from || null
      }
      if (msg.event === 'media') {
        dgConnection.send(Buffer.from(msg.media.payload, 'base64'))
      }
      if (msg.event === 'stop') dgConnection.finish()
    } catch (e) {}
  })

  ws.on('close', () => dgConnection.finish())
})

server.listen(8080, () => {
  console.log('Running on port 8080')
  console.log(booker.isConfigured()
    ? `Booker API: LIVE (location ${booker.LOCATION_ID})`
    : 'Booker API: NOT configured — using mock data')
})