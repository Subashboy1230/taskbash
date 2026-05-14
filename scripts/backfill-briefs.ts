// One-time backfill: generate a Why/Know/Done/Next brief for each existing
// Granola task. Run with:
//   cd ~/Desktop/ToDoo/cos-app-v1 && npm run backfill:briefs
//
// What it does:
//   1. Loads open Granola items with brief_status = 'pending'
//   2. Re-fetches the Granola note (summary + transcript) for synthesis context
//   3. Calls generateBrief() — Sonnet, structured Why/Know/Done/Next
//   4. Stores the brief jsonb + brief_generated_at + brief_status='generated'
//
// Cost: Sonnet, ~$0.015-0.02 per item. ~$1-1.50 for 67 items. Safe to re-run
// (only touches items still marked 'pending').

import { config } from 'dotenv'
import { resolve } from 'node:path'
config({ path: resolve(process.cwd(), '.env.local') })

async function main() {
  const USER_ID = process.env.APP_USER_ID
  const GRANOLA_API_KEY = process.env.GRANOLA_API_KEY
  if (!USER_ID) {
    console.error('APP_USER_ID is not set in .env.local')
    process.exit(1)
  }
  if (!GRANOLA_API_KEY) {
    console.error('GRANOLA_API_KEY is not set in .env.local')
    process.exit(1)
  }

  // Dynamic imports AFTER dotenv loads
  const { supabase } = await import('../lib/supabase')
  const { generateBrief } = await import('../lib/brief')
  const { fetchNoteDetail } = await import('../lib/extract/granola')

  console.log('Loading Granola items needing briefs for', USER_ID)
  const { data, error } = await supabase
    .from('items')
    .select('id, title, parent_context, source, tag, source_ref')
    .eq('user_id', USER_ID)
    .eq('source', 'granola')
    .in('status', ['open', 'in_progress'])
    .eq('brief_status', 'pending')
  if (error) {
    console.error('Load failed:', error.message)
    process.exit(1)
  }
  const items = data || []
  console.log(`Found ${items.length} items needing briefs\n`)

  // Cache notes — multiple items often come from the same meeting
  const noteCache = new Map<string, Awaited<ReturnType<typeof fetchNoteDetail>>>()

  let done = 0
  let failed = 0
  let i = 0

  for (const item of items) {
    i++
    process.stdout.write(`[${i}/${items.length}] ${item.title.slice(0, 55).padEnd(55)} `)

    try {
      // Re-fetch the Granola note for synthesis context
      const noteId = (item.source_ref as { granola_meeting_id?: string })?.granola_meeting_id
      let sourceContent: string | undefined

      if (noteId) {
        if (!noteCache.has(noteId)) {
          noteCache.set(noteId, await fetchNoteDetail(GRANOLA_API_KEY, noteId))
        }
        const note = noteCache.get(noteId)
        if (note) {
          const transcript = (note.transcript ?? [])
            .map(t => t.text)
            .join(' ')
            .slice(0, 6000)
          sourceContent = [
            note.summary_markdown || note.summary_text || '',
            transcript ? `\n\nTranscript excerpt:\n${transcript}` : '',
          ]
            .filter(Boolean)
            .join('')
        }
      }

      const brief = await generateBrief({
        title: item.title,
        parentContext: item.parent_context,
        source: item.source,
        tag: item.tag,
        sourceContent,
      })

      const { error: updateErr } = await supabase
        .from('items')
        .update({
          brief,
          brief_generated_at: new Date().toISOString(),
          brief_status: 'generated',
        })
        .eq('id', item.id)

      if (updateErr) {
        console.log(`✗ update failed: ${updateErr.message}`)
        failed++
        continue
      }
      console.log(`✓ ${brief.why.slice(0, 50)}...`)
      done++
    } catch (err) {
      console.log(`✗ ${err instanceof Error ? err.message : err}`)
      // Mark failed so a re-run can retry just these
      await supabase.from('items').update({ brief_status: 'failed' }).eq('id', item.id)
      failed++
    }
  }

  console.log(`\nDone. ${done} briefs generated, ${failed} failed.`)
  if (failed > 0) {
    console.log("Re-run the script to retry failed items (they're marked 'failed', not 'pending').")
    console.log("To retry failures: in Supabase, run  update items set brief_status='pending' where brief_status='failed';")
  }
}

main().catch(err => {
  console.error('FATAL:', err)
  process.exit(1)
})
