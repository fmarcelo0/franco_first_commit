// Read-only Booker lookups: availability, treatments, appointments, customers.

import {
  BASE_URL, LOCATION_ID, SUBSCRIPTION_KEY, MERCHANT_SUBSCRIPTION_KEY, DEFAULT_ROOM_ID,
  fetchWithTimeout, getAccessToken, authedHeaders, getMerchantAccessToken
} from './api-client'
import { normalizeCustomer, normalizeAppointment } from './response-normalizers'

interface Room {
  roomId: number
  name: string
  capacity: number
  treatments: number[]
}

// --- Availability --------------------------------------------------------

// Returns an array of ISO date strings the location has availability on.
// GET /v5/realtime_availability/AvailableDates
export async function getAvailableDates(
  { serviceId, fromDate, toDate }: { serviceId?: string | number; fromDate?: string; toDate?: string } = {}
): Promise<string[]> {
  const token = await getAccessToken()
  const now = new Date()
  const from = fromDate || now.toISOString()
  const to = toDate || new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString()

  const params = new URLSearchParams({ locationIds: String(LOCATION_ID), fromDate: from, toDate: to })
  if (serviceId) params.append('serviceId', String(serviceId))

  // Short timeout: this endpoint is currently unreliable; fail fast to mock.
  const res = await fetchWithTimeout(`${BASE_URL}/v5/realtime_availability/AvailableDates?${params}`, {
    headers: authedHeaders(token)
  }, 4000)
  if (!res.ok) throw new Error(`AvailableDates failed: ${res.status} ${await res.text()}`)

  const data = await res.json()
  return data.availability || []
}

// Time-block availability for a single day.
// GET /v5/realtime_availability/availability/1day
export async function getDayAvailability(
  { fromDateTime, serviceId }: { fromDateTime?: string; serviceId?: string | number } = {}
) {
  const token = await getAccessToken()
  const params = new URLSearchParams({
    LocationIds: String(LOCATION_ID),
    fromDateTime: fromDateTime || new Date().toISOString()
  })
  if (serviceId) params.append('serviceId[]', String(serviceId))

  const res = await fetchWithTimeout(`${BASE_URL}/v5/realtime_availability/availability/1day/?${params}`, {
    headers: authedHeaders(token)
  })
  if (!res.ok) throw new Error(`availability/1day failed: ${res.status} ${await res.text()}`)
  return res.json()
}

// POST /v5/realtime_availability/itinerary/1day/ -> open slots (time + employee)
// for a service on a given day. Returns [] when the account has no staff/schedule
// configured for that service (as in the current test sandbox). Request shape
// confirmed working against location 3749.
export async function searchAvailability(
  { treatmentId, date }: { treatmentId?: string | number; date?: string } = {}
): Promise<any[]> {
  const token = await getAccessToken()
  const res = await fetchWithTimeout(`${BASE_URL}/v5/realtime_availability/itinerary/1day/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY || '', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      LocationId: Number(LOCATION_ID),
      fromDateTime: `${date}T00:00:00`,
      Itineraries: [{ ItineraryProducts: [{ TreatmentId: Number(treatmentId), Quantity: 1 }] }]
    })
  })
  if (!res.ok) throw new Error(`searchAvailability failed: ${res.status} ${await res.text()}`)

  const data = await res.json()
  const slots: any[] = []
  for (const it of data.itineraryList || []) {
    for (const av of it.availabilities || []) {
      const item = (av.availabilityItems || [])[0] || {}
      slots.push({ startDateTime: av.startDateTime, employeeId: item.employeeId, serviceId: item.serviceId, duration: item.duration })
    }
  }
  return slots
}

// --- Treatments (services) -----------------------------------------------

// POST /v4.1/customer/treatments -> the location's services (with real IDs,
// names, prices, durations). Needed to map a spoken service to a TreatmentID.
export async function findTreatments(): Promise<any[]> {
  const token = await getAccessToken()
  const res = await fetchWithTimeout(`${BASE_URL}/v4.1/customer/treatments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY || '' },
    body: JSON.stringify({ LocationID: Number(LOCATION_ID), access_token: token })
  })
  if (!res.ok) throw new Error(`findTreatments failed: ${res.status} ${await res.text()}`)
  const data = await res.json()
  const list = data.Treatments || data.Results || []
  return list.map((t: any) => ({
    treatmentId: t.ID,
    name: t.Name,
    price: t.Price && t.Price.Amount,
    duration: t.TotalDuration
  }))
}

// Cached treatment list + word-based name search (so a caller's "eyebrow wax"
// can still match our "Waxing - Brows"). Ranks by how many query words hit.
let treatmentCache: any[] | null = null
export async function searchTreatments(query: string): Promise<any[]> {
  if (!treatmentCache) treatmentCache = await findTreatments()
  const words = (query || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3)
  if (!words.length) return treatmentCache.slice(0, 5)
  return treatmentCache
    .map((t: any) => ({ t, score: words.filter(w => (t.name || '').toLowerCase().includes(w)).length }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(x => x.t)
}

// --- Rooms (per-treatment room lookup) -----------------------------------
// A Booker treatment can ONLY be booked into a room that hosts it; booking into
// a non-supporting room returns "The room is not available at this time." So we
// resolve a matching room per treatment instead of using one hardcoded default
// room (which fails for every service that room doesn't host). Cached for the
// process — room config rarely changes.

// POST /v4.1/merchant/rooms -> the location's rooms, each with the list of
// TreatmentIDs it can host.
let roomsCache: Room[] | null = null
export async function getRooms(): Promise<Room[]> {
  if (roomsCache) return roomsCache
  const token = await getMerchantAccessToken()
  const res = await fetchWithTimeout(`${BASE_URL}/v4.1/merchant/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Ocp-Apim-Subscription-Key': MERCHANT_SUBSCRIPTION_KEY || '' },
    body: JSON.stringify({ access_token: token, LocationID: Number(LOCATION_ID) })
  })
  if (!res.ok) throw new Error(`getRooms failed: ${res.status} ${await res.text()}`)
  const data = await res.json()
  roomsCache = (data.Results || []).map((r: any) => ({
    roomId: r.ID,
    name: r.Name,
    capacity: r.Capacity,
    treatments: r.Treatments || []
  }))
  return roomsCache as Room[]
}

// Return a RoomID that can host this treatment, or undefined if none match.
// Prefers the smallest-capacity supporting room so a dedicated service room is
// chosen over a giant catch-all room (leaving large multi-use rooms free).
export async function findRoomForTreatment(treatmentId: string | number): Promise<number | undefined> {
  const id = Number(treatmentId)
  try {
    const matches = (await getRooms()).filter(r => r.treatments.includes(id))
    if (!matches.length) return undefined
    matches.sort((a, b) => (a.capacity || 0) - (b.capacity || 0))
    return matches[0].roomId
  } catch (err: any) {
    console.error('findRoomForTreatment failed:', err.message)
    return undefined
  }
}

// Resolve the room to book a treatment into: an explicit roomId wins, otherwise
// look one up by treatment, falling back to DEFAULT_ROOM_ID only as a last
// resort (which may itself not support the treatment).
export async function resolveRoomId(
  treatmentId: string | number | undefined,
  roomId: string | number | undefined
): Promise<string | number | undefined> {
  return roomId || (treatmentId != null ? await findRoomForTreatment(treatmentId) : undefined) || DEFAULT_ROOM_ID
}

// --- Appointments --------------------------------------------------------

// POST /v4.1/customer/appointments
// Pass a customerId, or a fromDate/toDate range.
export async function findAppointments(
  { customerId, fromDate, toDate }: { customerId?: string | number; fromDate?: string; toDate?: string } = {}
): Promise<any[]> {
  const token = await getAccessToken()
  const payload: any = { LocationID: Number(LOCATION_ID), access_token: token }
  if (customerId) payload.CustomerID = Number(customerId)
  if (fromDate) payload.FromStartDateOffset = fromDate
  if (toDate) payload.ToStartDateOffset = toDate

  const res = await fetchWithTimeout(`${BASE_URL}/v4.1/customer/appointments`, {
    method: 'POST',
    headers: authedHeaders(token),
    body: JSON.stringify(payload)
  })
  if (!res.ok) throw new Error(`FindAppointments failed: ${res.status} ${await res.text()}`)

  const data = await res.json()
  return data.Results || []
}

// --- Customers (Merchant API) --------------------------------------------
// POST /v4.1/merchant/customers. Confirmed against location 3749: search by
// "Phone" (last 10 digits), results come back in Customers[].Customer.
const FIND_CUSTOMERS_PATH = process.env.BOOKER_FIND_CUSTOMERS_PATH || '/v4.1/merchant/customers'

export async function findCustomers(
  { phone, firstName, lastName, email }: { phone?: string | number; firstName?: string; lastName?: string; email?: string } = {}
): Promise<any[]> {
  const token = await getMerchantAccessToken()
  const payload: any = { access_token: token, LocationID: Number(LOCATION_ID) }
  if (phone) payload.Phone = String(phone).replace(/\D/g, '').slice(-10)
  if (firstName) payload.FirstName = firstName
  if (lastName) payload.LastName = lastName
  if (email) payload.Email = email

  const res = await fetchWithTimeout(`${BASE_URL}${FIND_CUSTOMERS_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Ocp-Apim-Subscription-Key': MERCHANT_SUBSCRIPTION_KEY || '' },
    body: JSON.stringify(payload)
  })
  if (!res.ok) throw new Error(`FindCustomers failed: ${res.status} ${await res.text()}`)

  const data = await res.json()
  // Each result nests the record under .Customer; unwrap to a flat object.
  return (data.Customers || data.Results || []).map((c: any) => c.Customer || c)
}

// Full caller lookup: phone -> customer -> their appointments.
// Returns the same shape as a mock customer record, or null if not found.
export async function lookupCustomerByPhone(phone: string) {
  const matches = await findCustomers({ phone })
  if (!matches.length) return null

  // A phone can map to several customer records (especially test data). Use the
  // first for the caller's name/identity, but gather appointments across all of
  // them so we don't miss one. Each appointment carries its own customerId.
  const customer = normalizeCustomer(matches[0])
  let appointments: any[] = []
  for (const m of matches.slice(0, 5).map(normalizeCustomer)) {
    if (!m.customerId) continue
    try {
      const raw = await findAppointments({ customerId: m.customerId })
      appointments = appointments.concat(raw.map(normalizeAppointment))
    } catch (err: any) {
      console.error('FindAppointments failed for', m.customerId, err.message)
    }
  }
  // Only show appointments that aren't cancelled.
  appointments = appointments.filter(a => a.status !== 'Cancelled')
  return { ...customer, appointments }
}
