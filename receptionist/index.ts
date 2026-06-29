import 'dotenv/config'
import express from 'express'
import Anthropic from '@anthropic-ai/sdk'
import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk'
import { WebSocketServer, type WebSocket, type RawData } from 'ws'
import http from 'http'
import twilio from 'twilio'
import * as booker from '../booker-api'
import {
  MODEL, MAX_TOKENS,
  CONVERSATION_TTL_MS, PURGE_INTERVAL_MS,
  PORT, SPEECH_RATE, TRANSFER_NUMBER, STREAM_URL, DEEPGRAM_CONFIG,
  BUSINESS as MOCK_BUSINESS
} from '../app-constants'
import { describeCustomer, getAvailabilityBlock } from './receptionist-helpers'
import { resolveCaller, runBookingTool } from './booker-helpers'
import { SYSTEM_PROMPT, BOOKING_TOOLS } from '../app-constants/claude'

const app = express()
app.use(express.urlencoded({ extended: false }))

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const deepgramClient = createClient(process.env.DEEPGRAM_API_KEY)
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)

// Single place for the Claude call so its config isn't duplicated per turn.
function askClaude(systemPrompt: string, messages: Anthropic.MessageParam[]) {
  return anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    tools: BOOKING_TOOLS,
    messages
  })
}

app.get('/', (req, res) => res.send('Adore Salon AI Receptionist is running'))

app.post('/voice', (req, res) => {
  const from = req.body.From || ''
  res.type('text/xml')
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Say><prosody rate="${SPEECH_RATE}">Hello, thank you for calling ${MOCK_BUSINESS.name}. How can I help you today?</prosody></Say>
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
const conversations = new Map<string, { messages: Anthropic.MessageParam[]; ts: number }>()

// Purge stale conversations periodically so the map doesn't grow forever.
setInterval(() => {
  const cutoff = Date.now() - CONVERSATION_TTL_MS
  for (const [sid, c] of conversations) {
    if (c.ts < cutoff) conversations.delete(sid)
  }
}, PURGE_INTERVAL_MS).unref()

const server = http.createServer(app)
const wss = new WebSocketServer({ server, path: '/stream' })

wss.on('connection', (ws: WebSocket) => {
  let callSid = ''
  let callerPhone: string | null = null
  let isSpeaking = false
  let availabilityBlock: string | null = null  // fetched once per call, then reused
  let caller: any = null                        // resolved once per call (live or mock)
  let callerResolved = false


  const dgConnection = deepgramClient.listen.live(DEEPGRAM_CONFIG as any)

  dgConnection.on(LiveTranscriptionEvents.Transcript, async (data: any) => {
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
      const messages: Anthropic.MessageParam[] = [
        ...(prior ? prior.messages : []),
        { role: 'user', content: text }
      ]
      let response = await askClaude(systemPrompt, messages)

      // Let the AI call tools (lookup/booking) before its final spoken reply.
      while (response.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: response.content })
        const toolResults: Anthropic.ToolResultBlockParam[] = []
        for (const block of response.content) {
          if (block.type !== 'tool_use') continue
          console.log('Tool:', block.name, JSON.stringify(block.input))
          let result: string
          try {
            result = await runBookingTool(block.name, block.input, { callerPhone, caller })
          } catch (e: any) {
            result = `Error: ${e.message}`
          }
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: String(result) })
        }
        messages.push({ role: 'user', content: toolResults })
        response = await askClaude(systemPrompt, messages)
      }

      // Remember this turn so the AI has context for the caller's next sentence.
      messages.push({ role: 'assistant', content: response.content })
      conversations.set(callSid, { messages, ts: Date.now() })

      const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
      const reply = textBlock ? textBlock.text : ''
      console.log('AI:', reply)

      if (reply.includes('TRANSFER')) {
        await twilioClient.calls(callSid).update({
          twiml: `<Response><Say>Please hold while I transfer you.</Say><Dial>${TRANSFER_NUMBER}</Dial></Response>`
        })
        return
      }

      await twilioClient.calls(callSid).update({
        twiml: `<Response><Say><prosody rate="${SPEECH_RATE}">${reply}</prosody></Say><Connect><Stream url="${STREAM_URL}"><Parameter name="from" value="${callerPhone || ''}"/></Stream></Connect></Response>`
      })
    } catch (err) {
      console.error(err)
    } finally {
      isSpeaking = false
    }
  })

  ws.on('message', (data: RawData) => {
    try {
      const msg = JSON.parse(data.toString())
      if (msg.event === 'start') {
        callSid = msg.start.callSid
        callerPhone = msg.start.customParameters?.from || null
      }
      if (msg.event === 'media') {
        // Deepgram's send() accepts the raw audio bytes; its type is narrower
        // than Buffer, so cast to satisfy the checker.
        dgConnection.send(Buffer.from(msg.media.payload, 'base64') as any)
      }
      if (msg.event === 'stop') dgConnection.finish()
    } catch (e) {}
  })

  ws.on('close', () => dgConnection.finish())
})

server.listen(PORT, () => {
  console.log(`Running on port ${PORT}`)
  console.log(booker.isConfigured()
    ? `Booker API: LIVE (location ${booker.LOCATION_ID})`
    : 'Booker API: NOT configured — using mock data')
  // Warm the availability cache so the first caller doesn't wait on it.
  getAvailabilityBlock().then(() => console.log('Availability cache warmed')).catch(() => {})
})
