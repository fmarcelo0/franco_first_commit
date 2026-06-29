// Reshape raw Booker API responses into the flat shapes the rest of the app uses.

// Normalize a raw Booker customer object into the shape receptionist.js expects.
export function normalizeCustomer(raw: any) {
  return {
    customerId: raw.ID ?? raw.CustomerID,
    firstName: raw.FirstName || '',
    lastName: raw.LastName || '',
    phone: raw.CellPhone || raw.MobilePhone || raw.HomePhone || raw.Phone || '',
    email: raw.Email || ''
  }
}

// Normalize a raw Booker appointment (from FindAppointments) into our shape.
// Includes the IDs needed to cancel/reschedule.
export function normalizeAppointment(raw: any) {
  const t = raw.AppointmentTreatments && raw.AppointmentTreatments[0]
  return {
    appointmentId: raw.ID,
    customerId: raw.Customer?.ID,
    treatmentId: t?.Treatment?.ID,
    employeeId: t?.Employee?.ID,
    durationMin: t?.TreatmentDuration || 30,
    serviceName: t?.Treatment?.Name || raw.Treatment?.Name || 'Appointment',
    employeeName: t?.Employee?.FirstName || '',
    startDateTime: raw.StartDateTimeOffset || raw.StartDateTime,
    status: raw.Status?.Name || (raw.IsCancelled ? 'Cancelled' : 'Booked')
  }
}
