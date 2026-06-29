// Booker (Mindbody) API client — config, auth, and the low-level HTTP wrapper
// that the lookup/booking modules build on.
//
// Reads credentials from environment variables. If any required credential is
// missing, isConfigured() returns false and the app falls back to mock data —
// so this file is safe to ship before Booker provides the Site ID / keys.
//
// Required env vars (set these in .env locally and in Render for production):
//   BOOKER_LOCATION_ID       the Site ID / LocationID Booker assigns
//   BOOKER_CLIENT_ID         OAuth client id
//   BOOKER_CLIENT_SECRET     OAuth client secret
//   BOOKER_SUBSCRIPTION_KEY  Ocp-Apim-Subscription-Key (Customer subscription key)
//
// Optional — only needed for Merchant API calls (FindCustomers):
//   BOOKER_MERCHANT_SUBSCRIPTION_KEY  Merchant subscription key
//   BOOKER_PERSONAL_ACCESS_TOKEN      Merchant PAT (already URL-decoded)
// Optional:
//   BOOKER_BASE_URL          defaults to the staging host

export const BASE_URL = process.env.BOOKER_BASE_URL || 'https://api-staging.booker.com'
export const LOCATION_ID = process.env.BOOKER_LOCATION_ID
const CLIENT_ID = process.env.BOOKER_CLIENT_ID
const CLIENT_SECRET = process.env.BOOKER_CLIENT_SECRET
export const SUBSCRIPTION_KEY = process.env.BOOKER_SUBSCRIPTION_KEY
export const MERCHANT_SUBSCRIPTION_KEY = process.env.BOOKER_MERCHANT_SUBSCRIPTION_KEY
const PERSONAL_ACCESS_TOKEN = process.env.BOOKER_PERSONAL_ACCESS_TOKEN
// Default room/employee used when booking. A real available slot would supply
// these; until the availability endpoint is reliable they're a starting point.
export const DEFAULT_ROOM_ID = process.env.BOOKER_DEFAULT_ROOM_ID
export const DEFAULT_EMPLOYEE_ID = process.env.BOOKER_DEFAULT_EMPLOYEE_ID

export function isConfigured(): boolean {
  return Boolean(LOCATION_ID && CLIENT_ID && CLIENT_SECRET && SUBSCRIPTION_KEY)
}

// Merchant API (FindCustomers) needs the PAT flow + merchant subscription key.
export function isMerchantConfigured(): boolean {
  return Boolean(
    LOCATION_ID && CLIENT_ID && CLIENT_SECRET &&
    MERCHANT_SUBSCRIPTION_KEY && PERSONAL_ACCESS_TOKEN
  )
}

// fetch with an abort timeout so a slow/down Booker endpoint can't hang a call.
export async function fetchWithTimeout(url: string, opts: RequestInit = {}, ms = 8000): Promise<Response> {
  const ctrl = new AbortController()
  const id = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal })
  } finally {
    clearTimeout(id)
  }
}

// --- Auth token (cached until ~60s before expiry) ------------------------

let cachedToken: string | null = null
let tokenExpiresAt = 0

export async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: CLIENT_ID || '',
    client_secret: CLIENT_SECRET || '',
    scope: 'customer'
  })

  const res = await fetchWithTimeout(`${BASE_URL}/v5/auth/connect/token`, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY || '',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  })

  if (!res.ok) {
    throw new Error(`Booker auth failed: ${res.status} ${await res.text()}`)
  }

  const data = await res.json()
  cachedToken = data.access_token
  // expires_in is in seconds; refresh 60s early
  tokenExpiresAt = Date.now() + ((data.expires_in || 1800) - 60) * 1000
  return cachedToken as string
}

export function authedHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY || '',
    'Content-Type': 'application/json'
  }
}

// --- Merchant auth (Personal Access Token flow) --------------------------

let cachedMerchantToken: string | null = null
let merchantTokenExpiresAt = 0

export async function getMerchantAccessToken(): Promise<string> {
  if (cachedMerchantToken && Date.now() < merchantTokenExpiresAt) return cachedMerchantToken

  const body = new URLSearchParams({
    grant_type: 'personal_access_token',
    client_id: CLIENT_ID || '',
    client_secret: CLIENT_SECRET || '',
    scope: 'customer merchant',
    personal_access_token: PERSONAL_ACCESS_TOKEN || ''
  })

  const res = await fetchWithTimeout(`${BASE_URL}/v5/auth/connect/token`, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': MERCHANT_SUBSCRIPTION_KEY || '',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  })
  if (!res.ok) throw new Error(`Booker merchant auth failed: ${res.status} ${await res.text()}`)

  const data = await res.json()
  cachedMerchantToken = data.access_token
  merchantTokenExpiresAt = Date.now() + ((data.expires_in || 1800) - 60) * 1000
  return cachedMerchantToken as string
}

export function merchantHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    'Ocp-Apim-Subscription-Key': MERCHANT_SUBSCRIPTION_KEY || '',
    'Content-Type': 'application/json'
  }
}
