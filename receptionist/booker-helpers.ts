// Booker-specific helpers: prepare Booker-format inputs and execute the Booker
// operations behind the AI's tools.

import * as booker from '../booker-api'
import {
  TIMEZONE_OFFSET, DEFAULT_DURATION_MIN, CALLER_CACHE_TTL_MS,
  BUSINESS as MOCK_BUSINESS
} from '../app-constants'

// Build Booker-format start/end datetimes (Paris offset) for a service
// starting at HH:MM on a given date and lasting durationMin minutes.
export function buildSlotTimes(date: string, time: string, durationMin?: number) {
  const pad = (n: number) => String(n).padStart(2, '0')
  const [h, m] = time.split(':').map(Number)
  const endMin = h * 60 + m + (durationMin || DEFAULT_DURATION_MIN)
  return {
    reqTime: `${pad(h)}:${pad(m)}`,
    startDateTime: `${date}T${pad(h)}:${pad(m)}:00${TIMEZONE_OFFSET}`,
    endDateTime: `${date}T${pad(Math.floor(endMin / 60))}:${pad(endMin % 60)}:00${TIMEZONE_OFFSET}`
  }
}

// Map a requested staff name to a real Booker employee ID (undefined if none).
export function findStaffId(requested?: string): number | undefined {
  if (!requested) return undefined
  const q = requested.toLowerCase().trim()
  const match = MOCK_BUSINESS.staff.find(s => s.name.toLowerCase() === q) ||
                MOCK_BUSINESS.staff.find(s => s.name.toLowerCase().includes(q))
  return match && match.employeeId
}

// Identify the caller by phone via Booker. Cached per phone (5 min) so the
// lookup isn't repeated on every turn of a call.
const _callerCache = new Map<string, { caller: any; ts: number }>()
export async function resolveCaller(phone: string | null): Promise<any> {
  if (!phone) return null
  const hit = _callerCache.get(phone)
  if (hit && Date.now() - hit.ts < CALLER_CACHE_TTL_MS) return hit.caller

  let caller: any = null
  if (booker.isMerchantConfigured()) {
    try {
      caller = await booker.lookupCustomerByPhone(phone)
    } catch (err: any) {
      console.error('Booker customer lookup failed:', err.message)
    }
  }
  _callerCache.set(phone, { caller, ts: Date.now() })
  return caller
}

// Routes a tool name the AI chose to the matching Booker call.
export async function runBookingTool(
  name: string,
  input: any,
  ctx: { callerPhone?: string | null; caller?: any } = {}
): Promise<string> {
  if (name === 'lookup_service') {
    const matches = await booker.searchTreatments(input.service_name)
    if (!matches.length) return 'No matching service found.'
    return matches.map((m: any) => `${m.name} — $${m.price}, ${m.duration} min`).join('; ')
  }
  if (name === 'check_availability') {
    const matches = await booker.searchTreatments(input.service_name)
    if (!matches.length) return `Sorry, I couldn't find a service matching "${input.service_name}".`
    const svc = matches[0]
    try {
      const slots = await booker.searchAvailability({ treatmentId: svc.treatmentId, date: input.date })
      if (!slots.length) return `I'm not seeing open times listed for ${svc.name} on ${input.date} — what time were you hoping for, and I'll try to book it?`
      const times = [...new Set(slots.map((s: any) => (s.startDateTime || '').slice(11, 16)))].filter(Boolean).slice(0, 8)
      return `Open times for ${svc.name} on ${input.date}: ${times.join(', ')}.`
    } catch (e) {
      return `I couldn't pull live availability right now — what time were you thinking?`
    }
  }
  if (name === 'book_appointment') {
    const matches = await booker.searchTreatments(input.service_name)
    if (!matches.length) return `Sorry, I couldn't find a service matching "${input.service_name}".`
    const svc = matches[0]
    const { reqTime, startDateTime, endDateTime } = buildSlotTimes(input.date, input.time, svc.duration)

    let employeeId = findStaffId(input.employee)  // undefined -> default employee

    // Consult live availability to pick a real open slot (employee + time). If
    // the account returns no availability, fall through to the default employee.
    try {
      const slots = await booker.searchAvailability({ treatmentId: svc.treatmentId, date: input.date })
      if (slots.length) {
        const atTime = slots.filter((s: any) => (s.startDateTime || '').slice(11, 16) === reqTime)
        if (!atTime.length) {
          const open = [...new Set(slots.map((s: any) => (s.startDateTime || '').slice(11, 16)))].filter(Boolean).slice(0, 6)
          return `${input.time} isn't available for ${svc.name} on ${input.date}. Open times: ${open.join(', ')}. Which would you like?`
        }
        // Prefer the requested staff member if free at that time, else take any.
        const pick = (employeeId && atTime.find((s: any) => s.employeeId === employeeId)) || atTime[0]
        employeeId = pick.employeeId
      }
    } catch (e: any) {
      console.error('availability check failed, proceeding with default:', e.message)
    }

    try {
      const res = await booker.bookAppointment({
        firstName: input.firstname,
        lastName: input.lastname,
        phone: ctx.callerPhone || undefined,
        treatmentId: svc.treatmentId,
        employeeId,
        startDateTime,
        endDateTime
      })
      if (res.IsSuccess) {
        const id = res.Appointment && res.Appointment.ID
        return `Booked ${svc.name} on ${input.date} at ${input.time}.${id ? ' Confirmation number ' + id + '.' : ''}`
      }
      return `Could not book: ${res.ErrorMessage || 'unknown error'}`
    } catch (e: any) {
      return `Booking error: ${e.message}`
    }
  }
  if (name === 'cancel_appointment') {
    try {
      const res = await booker.cancelAppointment({ appointmentId: input.appointment_id })
      return res.IsSuccess ? 'That appointment has been cancelled.' : `Could not cancel: ${res.ErrorMessage || 'unknown error'}`
    } catch (e: any) {
      return `Cancel error: ${e.message}`
    }
  }
  if (name === 'reschedule_appointment') {
    const appt = (ctx.caller?.appointments || []).find((a: any) => a.appointmentId === Number(input.appointment_id))
    if (!appt) return "I couldn't find that appointment on your account."
    const { startDateTime, endDateTime } = buildSlotTimes(input.new_date, input.new_time, appt.durationMin)
    try {
      const res = await booker.rescheduleAppointment({
        appointmentId: appt.appointmentId,
        customerId: appt.customerId,
        treatmentId: appt.treatmentId,
        employeeId: appt.employeeId,
        startDateTime,
        endDateTime
      })
      if (res.IsSuccess) {
        return `Rescheduled to ${input.new_date} at ${input.new_time}.${res.Appointment ? ' New confirmation number ' + res.Appointment.ID + '.' : ''}`
      }
      return `Could not reschedule: ${res.ErrorMessage || 'that time is not available'}`
    } catch (e: any) {
      return `Reschedule error: ${e.message}`
    }
  }
  return 'Unknown tool.'
}
