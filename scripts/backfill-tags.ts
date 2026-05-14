// One-time backfill: classify existing items into action/reply/commit/fyi.
// Run with:
//   cd ~/Desktop/ToDoo/cos-app-v1 && npm run backfill:tags
//
// What it does:
//   1. Loads all items where status='open'
//   2. For each, sends title + parent_context to Claude Haiku to classify
//   3. Updates the tag in Supabase
//
// Cost: ~$0.001 per item × N items. Safe to re-run.

// IMPORTANT: load dotenv FIRST so lib/supabase.ts (which validates env vars
// at module-load time) sees the right values. We use dynamic imports below
// to defer module loading until after env is populated.
import { config } from 'dotenv'
import { resolve } from 'node:path'
config({ path: resolve(process.cwd(), '.env.local') })

type Tag = 'action' | 'reply' | 'commit' | 'fyi'

const SYSTEM_PROMPT = `You classify a single CoS task item into one of four tags.

Output STRICTLY one of: action, reply, commit, fyi
Nothing else — no explanation, no quotes, no punctuation.

Definitions:
- action — concrete task to DO (research, draft, schedule, decide, build, send a doc)
- reply — message owed back to someone (email reply, Slack DM response, text)
- commit — explicit promise made in a meeting ("I'll send the deck by Friday")
- fyi — purely informational, no action required

When in doubt between action and commit, prefer action.`

async function main() {
  const USER_ID = process.env.APP_USER_ID
  if (!USER_ID) {
    console.error('APP_USER_ID is not set in .env.local')
    process.exit(1)
  }

  // Dynamic imports AFTER dotenv loads so lib modules see the env
  const { supabase } = await import('../lib/supabase')
  const { anthropic, MODELS } = await import('../lib/anthropic')

  async function classify(title: string, parentContext: string | null): Promise<Tag> {
    const prompt = `Title: ${title}
Context: ${parentContext || '(no context)'}`

    const response = await anthropic.messages.create({
      model: MODELS.classifier,
      max_tokens: 8,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = response.content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map(b => b.text)
      .join('')
      .trim()
      .toLowerCase()

    if (text === 'action' || text === 'reply' || text === 'commit' || text === 'fyi') {
      return text
    }
    console.warn(`[backfill] unexpected response for "${title}": "${text}" — defaulting to commit`)
    return 'commit'
  }

  console.log('Loading open items for', USER_ID)
  const { data, error } = await supabase
    .from('items')
    .select('id, title, parent_context, tag')
    .eq('user_id', USER_ID)
    .eq('status', 'open')
  if (error) {
    console.error('Load failed:', error.message)
    process.exit(1)
  }
  const items = data || []
  console.log(`Found ${items.length} open items to classify\n`)

  let i = 0
  for (const item of items) {
    i++
    process.stdout.write(`[${i}/${items.length}] ${item.title.slice(0, 60).padEnd(60)} `)
    try {
      const tag = await classify(item.title, item.parent_context)
      const { error: updateErr } = await supabase
        .from('items')
        .update({ tag })
        .eq('id', item.id)
      if (updateErr) {
        console.log(`✗ update failed: ${updateErr.message}`)
        continue
      }
      console.log(`→ ${tag}`)
    } catch (err) {
      console.log(`✗ ${err instanceof Error ? err.message : err}`)
    }
  }

  console.log('\nDone. Counts by tag:')
  const { data: counts } = await supabase
    .from('items')
    .select('tag')
    .eq('user_id', USER_ID)
    .eq('status', 'open')
  const tally: Record<string, number> = {}
  for (const row of counts || []) {
    tally[row.tag || 'untagged'] = (tally[row.tag || 'untagged'] || 0) + 1
  }
  for (const [tag, n] of Object.entries(tally)) {
    console.log(`  ${tag}: ${n}`)
  }
}

main().catch(err => {
  console.error('FATAL:', err)
  process.exit(1)
})
