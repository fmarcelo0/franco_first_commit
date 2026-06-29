// Booker writes: create customers, book, cancel, and reschedule appointments.

import {
  BASE_URL, LOCATION_ID, SUBSCRIPTION_KEY, MERCHANT_SUBSCRIPTION_KEY,
  DEFAULT_ROOM_ID, DEFAULT_EMPLOYEE_ID,
  fetchWithTimeout, getAccessToken, getMerchantAccessToken
} from './api-client'

interface CustomerInput {
  firstName?: string
  lastName?: string
  email?: string
  phone?: string
}

interface AppointmentInput {
  customerId?: string | number
  customer?: CustomerInput
  treatmentId?: string | number
  startDateTime?: string
  employeeId?: string | number
  sendEmail?: boolean
  sendSms?: boolean
}

interface MerchantAppointmentInput {
  customerId?: string | number
  treatmentId?: string | number
  roomId?: string | number
  employeeId?: string | number
  startDateTime?: string
  endDateTime?: string
  resourceTypeId?: number
}

interface BookInput {
  firstName?: string
  lastName?: string
  email?: string
  phone?: string
  treatmentId?: string | number
  startDateTime?: string
  endDateTime?: string
  roomId?: string | number
  employeeId?: string | number
}

interface RescheduleInput {
  appointmentId?: string | number
  customerId?: string | number
  treatmentId?: string | number
  employeeId?: string | number
  roomId?: string | number
  startDateTime?: string
  endDateTime?: string
}

// --- Create customer + appointment (Customer API writes) -----------------

// POST /v4.1/customer/customer -> creates a client profile, returns it with a
// new customer ID. Needed before booking if the caller isn't already a client.
export async function createCustomer({ firstName, lastName, email, phone }: CustomerInput = {}): Promise<any> {
  const token = await getAccessToken()
  const payload: any = {
    LocationID: Number(LOCATION_ID),
    FirstName: firstName,
    LastName: lastName,
    Email: email,
    access_token: token
  }
  if (phone) payload.CellPhone = phone

  const res = await fetchWithTimeout(`${BASE_URL}/v4.1/customer/customer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY || '' },
    body: JSON.stringify(payload)
  })
  if (!res.ok) throw new Error(`createCustomer failed: ${res.status} ${await res.text()}`)
  return res.json()
}

// POST /v4.1/customer/appointment/create -> books an appointment for a single
// service. Uses the Customer API (no RoomID required, unlike the Merchant API).
//   customerId    - existing Booker customer ID
//   treatmentId   - from FindTreatments (the service)
//   startDateTime - ISO 8601 with offset, e.g. "2026-06-12T14:00:00-04:00"
//   employeeId    - optional specific staff member
export async function createAppointment(
  { customerId, customer = {}, treatmentId, startDateTime, employeeId, sendEmail = true, sendSms = false }: AppointmentInput = {}
): Promise<any> {
  const token = await getAccessToken()

  const treatmentSlot: any = {
    TreatmentID: Number(treatmentId),
    StartDateTimeOffset: startDateTime
  }
  if (employeeId) {
    treatmentSlot.EmployeeID = Number(employeeId)
    treatmentSlot.EmployeeWasRequested = true
  }

  // The Customer block needs name/phone/email in addition to the ID.
  const customerBlock: any = { ID: Number(customerId), SendEmail: sendEmail, SendSMS: sendSms }
  if (customer.firstName) customerBlock.FirstName = customer.firstName
  if (customer.lastName) customerBlock.LastName = customer.lastName
  if (customer.email) customerBlock.Email = customer.email
  if (customer.phone) customerBlock.CellPhone = customer.phone

  const payload = {
    LocationID: Number(LOCATION_ID),
    Customer: customerBlock,
    ItineraryTimeSlotList: [{ TreatmentTimeSlots: [treatmentSlot] }],
    access_token: token
  }

  const res = await fetchWithTimeout(`${BASE_URL}/v4.1/customer/appointment/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY || '' },
    body: JSON.stringify(payload)
  })
  if (!res.ok) throw new Error(`createAppointment failed: ${res.status} ${await res.text()}`)
  return res.json()
}

// POST /v4.1/merchant/appointment -> books an appointment AS THE BUSINESS, so
// the customer does not need to log in (unlike the Customer API). This is the
// right path for a receptionist. Requires merchant auth (PAT) + a RoomID.
export async function createMerchantAppointment(
  { customerId, treatmentId, roomId, employeeId, startDateTime, endDateTime, resourceTypeId = 2 }: MerchantAppointmentInput = {}
): Promise<any> {
  const token = await getMerchantAccessToken()
  const payload = {
    Customer: { ID: Number(customerId) },
    LocationID: Number(LOCATION_ID),
    AppointmentDateOffset: startDateTime,
    ResourceTypeID: resourceTypeId,
    AppointmentTreatmentDTOs: [{
      TreatmentID: Number(treatmentId),
      RoomID: Number(roomId),
      EmployeeID: Number(employeeId),
      StartTimeOffset: startDateTime,
      EndTimeOffset: endDateTime,
      IsDurationOverridden: true
    }],
    access_token: token
  }
  const res = await fetchWithTimeout(`${BASE_URL}/v4.1/merchant/appointment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Ocp-Apim-Subscription-Key': MERCHANT_SUBSCRIPTION_KEY || '' },
    body: JSON.stringify(payload)
  })
  if (!res.ok) throw new Error(`createMerchantAppointment failed: ${res.status} ${await res.text()}`)
  return res.json()
}

// High-level booking used by the call flow: creates the customer, then books
// the appointment as the business. Returns Booker's raw result (IsSuccess /
// ErrorMessage / Appointment).
export async function bookAppointment(
  { firstName, lastName, email, phone, treatmentId, startDateTime, endDateTime, roomId, employeeId }: BookInput
): Promise<any> {
  email = email || `${firstName}.${lastName}.${Date.now()}@noemail.adore`.toLowerCase()
  const cust = await createCustomer({ firstName, lastName, email, phone })
  const customerId = cust.CustomerID
  if (!customerId) throw new Error(`could not create customer: ${JSON.stringify(cust).slice(0, 150)}`)

  // Pass the offset-format datetimes straight through (Booker rejects the
  // millisecond/UTC "Z" format that Date.toISOString() produces).
  return createMerchantAppointment({
    customerId,
    treatmentId,
    roomId: roomId || DEFAULT_ROOM_ID,
    employeeId: employeeId || DEFAULT_EMPLOYEE_ID,
    startDateTime,
    endDateTime
  })
}

// PUT /v4.1/merchant/appointment/cancel -> cancels as the business (no customer
// login needed). Confirmed working against location 3749.
export async function cancelAppointment({ appointmentId }: { appointmentId?: string | number } = {}): Promise<any> {
  const token = await getMerchantAccessToken()
  const res = await fetchWithTimeout(`${BASE_URL}/v4.1/merchant/appointment/cancel`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Ocp-Apim-Subscription-Key': MERCHANT_SUBSCRIPTION_KEY || '' },
    body: JSON.stringify({ ID: Number(appointmentId), access_token: token })
  })
  if (!res.ok) throw new Error(`cancelAppointment failed: ${res.status} ${await res.text()}`)
  return res.json()
}

// Reschedule = rebook the same service/staff at the new time, then cancel the
// old one. (Booker has no atomic "move".) Book-first so a failed rebook can't
// lose the appointment — we only cancel the old one once the new one is booked.
export async function rescheduleAppointment(
  { appointmentId, customerId, treatmentId, employeeId, roomId, startDateTime, endDateTime }: RescheduleInput
): Promise<any> {
  const booked = await createMerchantAppointment({
    customerId,
    treatmentId,
    roomId: roomId || DEFAULT_ROOM_ID,
    employeeId: employeeId || DEFAULT_EMPLOYEE_ID,
    startDateTime,
    endDateTime
  })
  if (booked && booked.IsSuccess) {
    await cancelAppointment({ appointmentId }).catch(() => {})
  }
  return booked
}
