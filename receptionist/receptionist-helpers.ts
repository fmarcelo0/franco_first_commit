// Receptionist-specific helpers: turn data into text for the phone call and
// the Claude prompt.

import * as booker from '../booker-api'
import { AVAIL_TTL_MS } from '../app-constants'

export function formatDates(isoDates: string[]): string {
  return isoDates.map(d =>
    new Date(d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  ).join(', ')
}

export function describeCustomer(c: any): string {
  const appts = c.appointments.length
    ? c.appointments.map((a: any) => {
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

// Live availability from Booker when configured; generic guidance otherwise.
// Cached globally (it's the same for every caller) so we don't re-fetch — and
// hit the slow/down endpoint — on every turn of every call.
let _availCache: string | null = null
let _availCachedAt = 0

export async function getAvailabilityBlock(): Promise<string> {
  if (_availCache && Date.now() - _availCachedAt < AVAIL_TTL_MS) return _availCache

  let block: string | null = null
  if (booker.isConfigured()) {
    try {
      const dates = await booker.getAvailableDates()
      block = `AVAILABLE APPOINTMENT DATES (live from Booker):
${dates.length ? formatDates(dates) : 'No open dates in the next two weeks.'}`
    } catch (err: any) {
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
