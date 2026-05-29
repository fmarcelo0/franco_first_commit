const express = require('express')
const Anthropic = require('@anthropic-ai/sdk')

const app = express()
app.use(express.urlencoded({ extended: false }))

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM_PROMPT = `You are a friendly receptionist for Adore Salon.
You help callers with questions about hours, pricing, services, and staff availability.
Keep responses short and conversational — this is a phone call, 1-2 sentences max.
Hours: Monday-Saturday 9am-7pm, Sunday 10am-5pm.
If you cannot answer something, offer to connect them with a human receptionist.`

app.get('/', (req, res) => res.send('Adore Salon AI Receptionist is running'))

app.post('/voice', (req, res) => {
  res.type('text/xml')
  res.send(`
    <Response>
      <Say>Hello, thank you for calling Adore Salon. How can I help you today?</Say>
      <Gather input="speech" action="/respond" speechTimeout="auto" language="en-US">
      </Gather>
    </Response>
  `)
})

app.post('/respond', async (req, res) => {
  const callerSaid = req.body.SpeechResult || ''

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 150,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: callerSaid }]
  })

  const reply = message.content[0].text

  res.type('text/xml')
  res.send(`
    <Response>
      <Say>${reply}</Say>
      <Gather input="speech" action="/respond" speechTimeout="auto" language="en-US">
      </Gather>
    </Response>
  `)
})

app.listen(8080, () => console.log('Running on port 8080'))
