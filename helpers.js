// Helper functions for the AI receptionist, grouped by purpose.

const booker = require('./booker')
const {
  TIMEZONE_OFFSET, DEFAULT_DURATION_MIN, AVAIL_TTL_MS, CALLER_CACHE_TTL_MS,
  BUSINESS: MOCK_BUSINESS
} = require('./constants')

// --- Formatting / display ------------------------------------------------

function formatDates(isoDates) {
  return isoDates.map(d =>
    new Date(d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  ).join(', ')
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

// --- Booking / datetime --------------------------------------------------

// Build Booker-format start/end datetimes (Paris offset) for a service
// starting at HH:MM on a given date and lasting durationMin minutes.
function buildSlotTimes(date, time, durationMin) {
  const pad = n => String(n).padStart(2, '0')
  const [h, m] = time.split(':').map(Number)
  const endMin = h * 60 + m + (durationMin || DEFAULT_DURATION_MIN)
  return {
    reqTime: `${pad(h)}:${pad(m)}`,
    startDateTime: `${date}T${pad(h)}:${pad(m)}:00${TIMEZONE_OFFSET}`,
    endDateTime: `${date}T${pad(Math.floor(endMin / 60))}:${pad(endMin % 60)}:00${TIMEZONE_OFFSET}`
  }
}

// Map a requested staff name to a real Booker employee ID (undefined if none).
function findStaffId(requested) {
  if (!requested) return undefined
  const q = requested.toLowerCase().trim()
  const match = MOCK_BUSINESS.staff.find(s => s.name.toLowerCase() === q) ||
                MOCK_BUSINESS.staff.find(s => s.name.toLowerCase().includes(q))
  return match && match.employeeId
}

// --- Data fetch + cache --------------------------------------------------

// Live availability from Booker when configured; generic guidance otherwise.
// Cached globally (it's the same for every caller) so we don't re-fetch — and
// hit the slow/down endpoint — on every turn of every call.
let _availCache = null
let _availCachedAt = 0

async function getAvailabilityBlock() {
  if (_availCache && Date.now() - _availCachedAt < AVAIL_TTL_MS) return _availCache

  let block = null
  if (booker.isConfigured()) {
    try {
      const dates = await booker.getAvailableDates()
      block = `AVAILABLE APPOINTMENT DATES (live from Booker):
${dates.length ? formatDates(dates) : 'No open dates in the next two weeks.'}`
    } catch (err) {
      console.error('Booker availability lookup failed, using mock:', err.message)
    }
  }
  if (!block) {
    block = `AVAILABILITY:
Live availability is temporarily unavailable. Do not quote or invent specific open dates or times. Instead, ask the caller what day and time they'd like, then attempt the booking — it will confirm if the slot is open or you can offer to try another time.`
  }

  _availCache = block
  _availCachedAt = Date.now()
  return block
}

// Identify the caller by phone via Booker. Cached per phone (5 min) so the
// lookup isn't repeated on every turn of a call.
const _callerCache = new Map()
async function resolveCaller(phone) {
  if (!phone) return null
  const hit = _callerCache.get(phone)
  if (hit && Date.now() - hit.ts < CALLER_CACHE_TTL_MS) return hit.caller

  let caller = null
  if (booker.isMerchantConfigured()) {
    try {
      caller = await booker.lookupCustomerByPhone(phone)
    } catch (err) {
      console.error('Booker customer lookup failed:', err.message)
    }
  }
  _callerCache.set(phone, { caller, ts: Date.now() })
  return caller
}

// --- Tool dispatch -------------------------------------------------------

// Routes a tool name the AI chose to the matching Booker call.
async function runBookingTool(name, input, ctx = {}) {
  if (name === 'lookup_service') {
    const matches = await booker.searchTreatments(input.service_name)
    if (!matches.length) return 'No matching service found.'
    return matches.map(m => `${m.name} — $${m.price}, ${m.duration} min`).join('; ')
  }
  if (name === 'check_availability') {
    const matches = await booker.searchTreatments(input.service_name)
    if (!matches.length) return `Sorry, I couldn't find a service matching "${input.service_name}".`
    const svc = matches[0]
    try {
      const slots = await booker.searchAvailability({ treatmentId: svc.treatmentId, date: input.date })
      if (!slots.length) return `I'm not seeing open times listed for ${svc.name} on ${input.date} — what time were you hoping for, and I'll try to book it?`
      const times = [...new Set(slots.map(s => (s.startDateTime || '').slice(11, 16)))].filter(Boolean).slice(0, 8)
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
        const atTime = slots.filter(s => (s.startDateTime || '').slice(11, 16) === reqTime)
        if (!atTime.length) {
          const open = [...new Set(slots.map(s => (s.startDateTime || '').slice(11, 16)))].filter(Boolean).slice(0, 6)
          return `${input.time} isn't available for ${svc.name} on ${input.date}. Open times: ${open.join(', ')}. Which would you like?`
        }
        // Prefer the requested staff member if free at that time, else take any.
        const pick = (employeeId && atTime.find(s => s.employeeId === employeeId)) || atTime[0]
        employeeId = pick.employeeId
      }
    } catch (e) {
      console.error('availability check failed, proceeding with default:', e.message)
    }

    try {
      const res = await booker.bookAppointment({
        firstName: input.firstname,
        lastName: input.lastname,
        phone: ctx.callerPhone,
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
    } catch (e) {
      return `Booking error: ${e.message}`
    }
  }
  if (name === 'cancel_appointment') {
    try {
      const res = await booker.cancelAppointment({ appointmentId: input.appointment_id })
      return res.IsSuccess ? 'That appointment has been cancelled.' : `Could not cancel: ${res.ErrorMessage || 'unknown error'}`
    } catch (e) {
      return `Cancel error: ${e.message}`
    }
  }
  if (name === 'reschedule_appointment') {
    const appt = (ctx.caller?.appointments || []).find(a => a.appointmentId === Number(input.appointment_id))
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
    } catch (e) {
      return `Reschedule error: ${e.message}`
    }
  }
  return 'Unknown tool.'
}

module.exports = {
  formatDates,
  describeCustomer,
  buildSlotTimes,
  findStaffId,
  getAvailabilityBlock,
  resolveCaller,
  runBookingTool
}
