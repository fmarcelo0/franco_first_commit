// Read-only Booker lookups: availability, treatments, appointments, customers.

import {
  BASE_URL, LOCATION_ID, SUBSCRIPTION_KEY, MERCHANT_SUBSCRIPTION_KEY,
  fetchWithTimeout, getAccessToken, authedHeaders, getMerchantAccessToken
} from './api-client'
import { normalizeCustomer, normalizeAppointment } from './response-normalizers'

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
