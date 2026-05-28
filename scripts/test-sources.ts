// Quick test: run the Calendar + Linear extractors and print what they find
// — WITHOUT touching the database. Verifies the new sources work end-to-end
// (auth → external API → parsed items) before tomorrow morning's cron.
//
// Run with:
//   cd ~/Desktop/ToDoo/cos-app-v1 && npm run test:sources

import { config } from 'dotenv'
import { resolve } from 'node:path'
config({ path: resolve(process.cwd(), '.env.local') })

async function main() {
  const required = ['NANGO_SECRET_KEY', 'APP_USER_ID', 'ANTHROPIC_API_KEY']
  const missing = required.filter(k => !process.env[k])
  if (missing.length > 0) {
    console.error('Missing env vars in .env.local:', missing.join(', '))
    process.exit(1)
  }

  // Dynamic import after dotenv loads (lib/nango.ts validates env at module load).
  const { extractCalendarPrepItems } = await import('../lib/extract/calendar')
  const { extractLinearActionItems } = await import('../lib/extract/linear')

  const userEmail = 'subashraj411@gmail.com'

  // ─── Google Calendar ──────────────────────────────────────────────
  console.log('━━━ Google Calendar ━━━')
  try {
    const calendarItems = await extractCalendarPrepItems({ userEmail })
    if (calendarItems.length === 0) {
      console.log('No prep-worthy events in the next 36 hours.\n')
    } else {
      console.log(`Found ${calendarItems.length} upcoming meeting(s):\n`)
      for (const item of calendarItems) {
        const when = item.due_at
          ? new Date(item.due_at).toLocaleString()
          : 'no time'
        console.log(`  • ${item.title}`)
        console.log(`    when:   ${when}`)
        console.log(`    where:  ${item.parent_context}`)
        if (item.brief) {
          console.log(`    why:    ${item.brief.why}`)
          if (item.brief.know?.length) {
            console.log(`    know:   ${item.brief.know.slice(0, 2).join(' | ')}`)
          }
        }
        console.log('')
      }
      console.log('Calendar extraction works end-to-end.\n')
    }
  } catch (err) {
    console.error('Calendar failed:', err instanceof Error ? err.message : err)
    // Dig out the actual HTTP response body so we know WHO returned 400
    // (Nango "integration not found" vs Google "bad scope/param").
    const e = err as {
      response?: { status?: number; data?: unknown; headers?: unknown }
      config?: { url?: string; baseURL?: string; params?: unknown }
    }
    console.error('  status:', e?.response?.status ?? '(none)')
    console.error('  url:   ', (e?.config?.baseURL ?? '') + (e?.config?.url ?? ''))
    console.error('  params:', JSON.stringify(e?.config?.params ?? null))
    console.error('  body:  ', JSON.stringify(e?.response?.data ?? null, null, 2))
    console.error('')
  }

  // ─── Linear ───────────────────────────────────────────────────────
  console.log('━━━ Linear ━━━')
  try {
    const linearItems = await extractLinearActionItems({ userEmail })
    if (linearItems.length === 0) {
      console.log('No open issues assigned to you.\n')
    } else {
      console.log(`Found ${linearItems.length} open issue(s):\n`)
      for (const item of linearItems) {
        const urgent = item.urgent ? ' [URGENT]' : ''
        const due = item.due_at
          ? new Date(item.due_at).toLocaleDateString()
          : 'no deadline'
        console.log(`  • ${item.title}${urgent}`)
        console.log(`    team:  ${item.parent_context}`)
        console.log(`    due:   ${due}`)
        console.log('')
      }
      console.log('Linear extraction works end-to-end.\n')
    }
  } catch (err) {
    console.error('Linear failed:', err instanceof Error ? err.message : err)
    console.error('')
  }
}

main().catch(err => {
  console.error('\nFATAL:', err instanceof Error ? err.message : err)
  process.exit(1)
})
