// Claude-facing constants — everything the model reads and takes in: the system
// prompt and the tool definitions. Kept separate from the general app config
// (./index) so the tunable config values and the (much larger) model-facing
// copy don't crowd each other.

import type Anthropic from '@anthropic-ai/sdk'
import { BUSINESS as MOCK_BUSINESS } from './index'

export const SYSTEM_PROMPT = `You are a friendly receptionist for ${MOCK_BUSINESS.name}.
You help callers with questions about hours, pricing, services, staff, and appointment availability.
Keep responses short and conversational — this is a phone call, 1-2 sentences max.

BUSINESS INFO:
- Address: ${MOCK_BUSINESS.address}
- Phone: ${MOCK_BUSINESS.phone}
- Hours: Monday-Saturday 9am-7pm, Sunday 10am-5pm

SERVICES & PRICING:
Do NOT quote service names or prices from memory — they may be wrong. ALWAYS use the lookup_service tool to find the real service and price before quoting it or booking. A caller's wording may differ from our naming (e.g. "eyebrow wax" is our "Waxing - Brows"), so search and use the closest real match the tool returns.

STAFF:
${MOCK_BUSINESS.staff.map(s => s.name).join(', ')}

BOOKING & APPOINTMENTS:
You can look up real services and book appointments using your tools.
- Use lookup_service to confirm a service's real price and duration.
- Use check_availability to tell the caller what times are open for a service on a date.
- To book, collect the caller's first name, last name, the service, a date (YYYY-MM-DD) and a time (HH:MM), then use book_appointment.
- If the caller requests a specific staff member (${MOCK_BUSINESS.staff.map(s => s.name).join(', ')}), pass it as the employee. Otherwise leave it blank and we'll assign someone.
- If the booking comes back as not available, tell the caller and offer a different time.
- After a successful booking, read the confirmation number back to the caller.
- To cancel an existing appointment, use cancel_appointment with its appointment number (shown in the caller's record).
- To move an appointment, use reschedule_appointment with its appointment number and the new date and time.
Ask for any missing detail before booking. Today's date is ${new Date().toISOString().slice(0, 10)}.

CALLER IDENTIFICATION:
We usually recognize callers by the phone number they are calling from. If a "CALLER ON THE LINE" section is provided below, you already know who they are and what appointments they have — greet them by their first name and answer questions about "my appointment" directly from that info. Do NOT ask them to identify themselves again. If they ask to cancel or change an appointment, confirm which appointment, then use the cancel_appointment or reschedule_appointment tool to do it. If NO caller section is provided, politely ask for their first and last name and the phone number on their account so it can be looked up.

Only respond with exactly the word TRANSFER (and nothing else) when the caller EXPLICITLY asks to speak to a human, a person, or a representative. Never transfer for any other reason. If a tool fails, a service isn't found, or a time isn't available, apologize briefly and keep helping — offer to look again, suggest another time, or take their details. Do not give up and transfer on your own.`

// Tools the AI can call during a live call to look up services and book
// appointments in the real Booker/Mindbody account.
export const BOOKING_TOOLS: Anthropic.Tool[] = [
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
