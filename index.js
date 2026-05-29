const express = require('express')
const Anthropic = require('@anthropic-ai/sdk')
const { createClient, LiveTranscriptionEvents } = require('@deepgram/sdk')
const WebSocket = require('ws')
const http = require('http')
const twilio = require('twilio')

const app = express()
app.use(express.urlencoded({ extended: false }))

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const deepgramClient = createClient(process.env.DEEPGRAM_API_KEY)
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)

const SYSTEM_PROMPT = `You are a friendly receptionist for Adore Salon.
You help callers with questions about hours, pricing, services, and staff availability.
Keep responses short and conversational — this is a phone call, 1-2 sentences max.
Hours: Monday-Saturday 9am-7pm, Sunday 10am-5pm.
Services: manicure, pedicure, wax, haircuts, and messages.
If you cannot answer something, offer to connect them with a human receptionist.`

app.get('/', (req, res) => res.send('Adore Salon AI Receptionist is running'))

app.post('/voice', (req, res) => {
  res.type('text/xml')
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Say>Hello, thank you for calling Adore Salon. How can I help you today?</Say>
      <Connect>
        <Stream url="wss://${req.headers.host}/stream" />
      </Connect>
    </Response>
  `)
})

const server = http.createServer(app)
const wss = new WebSocket.Server({ server, path: '/stream' })

wss.on('connection', (ws) => {
  let callSid = null
  let isSpeaking = false

  const dgConnection = deepgramClient.listen.live({
    model: 'nova-2-phonecall',
    language: 'en-US',
    smart_format: true,
    interim_results: false,
    endpointing: 500,
    encoding: 'mulaw',
    sample_rate: 8000
  })

  dgConnection.on(LiveTranscriptionEvents.Transcript, async (data) => {
    const text = data.channel?.alternatives[0]?.transcript
    if (!text || !data.is_final || isSpeaking) return

    console.log('Caller:', text)
    isSpeaking = true

    try {
      const message = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 100,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: text }]
      })

      const reply = message.content[0].text
      console.log('AI:', reply)

      await twilioClient.calls(callSid).update({
        twiml: `<Response><Say>${reply}</Say><Connect><Stream url="wss://franco-first-commit.onrender.com/stream"/></Connect></Response>`
      })
    } catch (err) {
      console.error(err)
    } finally {
      isSpeaking = false
    }
  })

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data)
      if (msg.event === 'start') callSid = msg.start.callSid
      if (msg.event === 'media') {
        dgConnection.send(Buffer.from(msg.media.payload, 'base64'))
      }
      if (msg.event === 'stop') dgConnection.finish()
    } catch (e) {}
  })

  ws.on('close', () => dgConnection.finish())
})

server.listen(8080, () => console.log('Running on port 8080'))