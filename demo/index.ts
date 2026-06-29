// Terminal demo of the Adore Salon receptionist — type as if you were the
// caller and the AI answers, looking up services, checking availability, and
// booking against the REAL Booker account. It drives the exact same brain the
// phone uses (the SYSTEM_PROMPT, BOOKING_TOOLS, and runBookingTool from the
// receptionist modules) — just over a keyboard instead of Twilio + Deepgram.
//
// Every conversation is auto-saved to a transcript you can hand to Booker.
//
// Run (after `npm run build`):
//   npm run demo
//   npm run demo -- --from 9735551234   # simulate a recognized caller by phone
//
// Requires ANTHROPIC_API_KEY and the Booker credentials in .env. Bookings made
// here are REAL appointments in the connected Booker account.

import 'dotenv/config'
import * as fs from 'fs'
import * as path from 'path'
import * as readline from 'readline'
import Anthropic from '@anthropic-ai/sdk'
import * as booker from '../booker-api'
import { MODEL, MAX_TOKENS } from '../app-constants'
import { SYSTEM_PROMPT, BOOKING_TOOLS } from '../app-constants/claude'
import { describeCustomer, getAvailabilityBlock } from '../receptionist/receptionist-helpers'
import { resolveCaller, runBookingTool } from '../receptionist/booker-helpers'

const args = process.argv.slice(2)
const fromArg = (() => { const i = args.indexOf('--from'); return i !== -1 ? args[i + 1] : null })()

const C = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Transcript file (created in main(), after the API-key check).
const transcriptPath = path.join(__dirname, '..', '..', 'transcripts',
  `adore-demo-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.txt`)
function writeLine(line = '') { fs.appendFileSync(transcriptPath, line + '\n') }

// One conversational turn — mirrors the tool loop in receptionist/index.ts.
// Returns the updated message history, the spoken reply, and any tools used.
async function converse(
  prior: Anthropic.MessageParam[],
  userText: string,
  systemPrompt: string,
  ctx: { callerPhone?: string | null; caller?: any }
): Promise<{ messages: Anthropic.MessageParam[]; reply: string; toolCalls: any[] }> {
  const messages: Anthropic.MessageParam[] = [...prior, { role: 'user', content: userText }]
  const toolCalls: any[] = []

  const ask = () => anthropic.messages.create({
    model: MODEL, max_tokens: MAX_TOKENS, system: systemPrompt, tools: BOOKING_TOOLS, messages
  })

  let response = await ask()
  while (response.stop_reason === 'tool_use') {
    messages.push({ role: 'assistant', content: response.content })
    const toolResults: Anthropic.ToolResultBlockParam[] = []
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue
      let result: string
      try {
        result = await runBookingTool(block.name, block.input, ctx)
      } catch (e: any) {
        result = `Error: ${e.message}`
      }
      toolCalls.push({ name: block.name, input: block.input, result })
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: String(result) })
    }
    messages.push({ role: 'user', content: toolResults })
    response = await ask()
  }

  messages.push({ role: 'assistant', content: response.content })
  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
  return { messages, reply: textBlock ? textBlock.text : '', toolCalls }
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('\nMissing ANTHROPIC_API_KEY. The AI brain is real even in the demo.')
    console.error('Add it to .env (ANTHROPIC_API_KEY=sk-...) and re-run.\n')
    process.exit(1)
  }

  fs.mkdirSync(path.dirname(transcriptPath), { recursive: true })
  const mode = booker.isConfigured() ? `LIVE Booker (location ${booker.LOCATION_ID})` : 'Booker NOT configured (mock fallback)'
  writeLine('Adore Salon — AI Receptionist demo transcript')
  writeLine(`Date: ${new Date().toString()}`)
  writeLine(`Mode: ${mode}`)
  if (fromArg) writeLine(`Caller phone: ${fromArg}`)
  writeLine('='.repeat(60))
  writeLine()

  console.log(C.bold('\n  Adore Salon — AI Receptionist (demo)'))
  console.log(C.dim(`  Mode: ${mode}`))
  if (booker.isConfigured()) console.log(C.yellow('  ⚠ LIVE: bookings create REAL appointments in the Booker account.'))
  console.log(C.dim('  Type as the caller. Ctrl+C to end and save the transcript.'))
  console.log(C.dim('  Try: "how much is a gel manicure?", "book me a manicure'
    + ' Friday at 2pm, my name is Sam Lee".\n'))

  // Resolve per-call context once, exactly like the phone flow does per call.
  const availabilityBlock = await getAvailabilityBlock()
  const caller = await resolveCaller(fromArg)
  if (caller) {
    console.log(C.green(`  ☎ Recognized caller: ${caller.firstName} ${caller.lastName}\n`))
    writeLine(`[caller recognized: ${caller.firstName} ${caller.lastName}, ${caller.appointments.length} upcoming appointment(s)]`)
    writeLine()
  }
  const customerSection = caller ? `\n\nCALLER ON THE LINE:\n${describeCustomer(caller)}` : ''
  const systemPrompt = `${SYSTEM_PROMPT}\n\n${availabilityBlock}${customerSection}`

  const greeting = 'Hello, thank you for calling Adore Salon. How can I help you today?'
  console.log(C.cyan('  Receptionist: ') + greeting + '\n')
  writeLine(`Receptionist: ${greeting}`)
  writeLine()

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: C.bold('  You: ') })
  let history: Anthropic.MessageParam[] = []
  rl.prompt()

  rl.on('line', async (line) => {
    const text = line.trim()
    if (!text) { rl.prompt(); return }
    rl.pause()
    writeLine(`Caller: ${text}`)
    try {
      const { messages, reply, toolCalls } = await converse(history, text, systemPrompt, { callerPhone: fromArg, caller })
      history = messages
      for (const t of toolCalls) {
        const summary = `  [action: ${t.name}(${JSON.stringify(t.input)}) -> ${t.result}]`
        console.log(C.dim(summary))
        writeLine(summary.trim())
      }
      const spoken = reply.includes('TRANSFER')
        ? '(transferring you to a human — +1 973-903-5245)'
        : reply
      console.log(C.cyan('\n  Receptionist: ') + spoken + '\n')
      writeLine(`Receptionist: ${spoken}`)
      writeLine()
    } catch (err: any) {
      console.error(C.dim(`\n  [error: ${err.message}]\n`))
      writeLine(`[error: ${err.message}]`)
    }
    rl.resume()
    rl.prompt()
  })

  rl.on('close', () => {
    writeLine()
    writeLine('[end of call]')
    console.log(C.dim('\n  Transcript saved to: ') + transcriptPath + '\n')
    process.exit(0)
  })
}

main()
