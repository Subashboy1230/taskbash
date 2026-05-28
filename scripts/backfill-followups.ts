// Backfill pre-drafted follow-ups for existing open Granola items.
//
// For every items row where source='granola', tag in ('commit','reply'),
// status='open', and proposed_action is null:
//   1. Look up the source meeting note via granola_meeting_id (in source_ref)
//   2. Call draftFollowup() with the meeting summary + attendees
//   3. UPDATE the row with the drafted proposed_action + source_excerpt
//
// One-off: future morning-digest inserts already do this inline. Run once
// after deploying the followup change so the existing 18-ish open items
// start showing drafts in the UI.
//
// Run with:
//   cd ~/Desktop/ToDoo/cos-app-v1 && npm run backfill:followups

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

  // Imports after dotenv loads (some modules validate env at import time).
  const { supabase } = await import('../lib/supabase')
  const { draftFollowup } = await import('../lib/draft/followup')
  const { getActiveConnection } = await import('../lib/connections')
  const USER_ID = process.env.APP_USER_ID!
  const USER_EMAIL = 'subash@sigiq.ai' // TODO(week5): pull from users table

  const conn = await getActiveConnection('granola')
  if (!conn || !conn.api_key) {
    console.error('Granola not connected — visit /connections to set it up.')
    process.exit(1)
  }

  // Find candidates.
  const { data: rows, error: queryErr } = await supabase
    .from('items')
    .select(
      'id, title, tag, source_ref, source_excerpt, proposed_action, parent_context'
    )
    .eq('user_id', USER_ID)
    .eq('source', 'granola')
    .in('tag', ['commit', 'reply', 'action'])
    .eq('status', 'open')
    .is('proposed_action', null)
    .order('first_seen_at', { ascending: false })
  if (queryErr) {
    console.error('Failed to query items:', queryErr.message)
    process.exit(1)
  }
  const candidates = (rows ?? []) as Array<{
    id: string
    title: string
    tag: string
    source_ref: { granola_meeting_id?: string; granola_meeting_date?: string }
    parent_context: string | null
  }>
  console.log(`Found ${candidates.length} candidates without drafts.\n`)
  if (candidates.length === 0) {
    console.log('Nothing to backfill.')
    return
  }

  // We need the FULL meeting note (attendees + summary) per item. Group by
  // meeting id so we don't re-fetch the same note for sibling items.
  const meetingIds = Array.from(
    new Set(
      candidates
        .map(c => c.source_ref?.granola_meeting_id)
        .filter((v): v is string => !!v)
    )
  )
  console.log(`Fetching ${meetingIds.length} unique Granola notes…`)
  const noteById = new Map<string, GranolaNoteDetail>()
  for (const id of meetingIds) {
    const note = await fetchNote(conn.api_key, id)
    if (note) noteById.set(id, note)
  }
  console.log(`  ${noteById.size}/${meetingIds.length} fetched.\n`)

  // Iterate items and draft.
  let drafted = 0
  let skipped = 0
  let failed = 0
  for (let i = 0; i < candidates.length; i++) {
    const item = candidates[i]
    const meetingId = item.source_ref?.granola_meeting_id
    const note = meetingId ? noteById.get(meetingId) : null
    if (!note) {
      console.log(`  [${i + 1}/${candidates.length}] (no note) skip: ${item.title.slice(0, 80)}`)
      skipped++
      continue
    }
    const sourceText = note.summary_markdown || note.summary_text || ''
    const meetingTitle =
      note.title || note.calendar_event?.event_title || 'Untitled meeting'
    try {
      const action = await draftFollowup({
        actionTitle: item.title,
        meetingTitle,
        meetingDate: note.created_at,
        meetingContext: sourceText,
        attendees: note.attendees ?? [],
        userEmail: USER_EMAIL,
      })
      const excerpt = buildExcerpt(meetingTitle, note.created_at, sourceText)
      const update: { source_excerpt: string; proposed_action?: unknown } = {
        source_excerpt: excerpt,
      }
      if (action) update.proposed_action = action
      const { error: upErr } = await supabase
        .from('items')
        .update(update)
        .eq('id', item.id)
      if (upErr) throw upErr
      if (action) {
        drafted++
        console.log(`  [${i + 1}/${candidates.length}] DRAFT → ${action.to[0]}: ${item.title.slice(0, 60)}`)
      } else {
        skipped++
        console.log(`  [${i + 1}/${candidates.length}] no draft   ${item.title.slice(0, 60)}`)
      }
    } catch (err) {
      failed++
      console.error(`  [${i + 1}/${candidates.length}] FAIL: ${item.title.slice(0, 60)} — ${err instanceof Error ? err.message : err}`)
    }
  }

  console.log(`\nDone — drafted: ${drafted}, skipped: ${skipped}, failed: ${failed}`)
}

interface GranolaNoteDetail {
  id: string
  title: string | null
  created_at: string
  calendar_event?: { event_title?: string }
  attendees: Array<{ name: string; email: string }>
  summary_text?: string
  summary_markdown?: string | null
}

async function fetchNote(apiKey: string, id: string): Promise<GranolaNoteDetail | null> {
  const url = `https://public-api.granola.ai/v1/notes/${id}?include=transcript`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } })
  if (!res.ok) {
    console.error(`  failed to fetch ${id}: ${res.status}`)
    return null
  }
  return (await res.json()) as GranolaNoteDetail
}

function buildExcerpt(title: string, date: string | undefined, summary: string): string {
  const truncated = summary.slice(0, 2500)
  const ellipsis = summary.length > 2500 ? '\n…' : ''
  const dateLine = date
    ? `Date: ${new Date(date).toLocaleDateString('en-US', { dateStyle: 'medium' })}\n`
    : ''
  return `Meeting: ${title}\n${dateLine}\n${truncated}${ellipsis}`
}

main().catch(err => {
  console.error('FATAL:', err instanceof Error ? err.message : err)
  process.exit(1)
})
