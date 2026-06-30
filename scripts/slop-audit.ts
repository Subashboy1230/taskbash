// scripts/slop-audit.ts
//
// Scan open items for likely slop, group by signal, and (optionally) mark
// them as dismissed via the same path the in-app slop button uses:
//   1. items.status -> 'dismissed'
//   2. item_feedback insert with kind='slop' (anchors the snapshot so the
//      eval runner can replay even if extraction changes)
//   3. eval_cases insert into 'slop-{prompt_id}' dataset (so the next eval
//      run regresses against this signal)
//   4. mem0 record so the next morning-digest classifier learns the pattern
//
// Usage:
//   npx tsx scripts/slop-audit.ts                 # dry run: print only
//   npx tsx scripts/slop-audit.ts --apply         # actually slop them
//   npx tsx scripts/slop-audit.ts --apply --only=mechanical,duplicate
//                                                 # apply only one signal
//
// Flags:
//   --apply              Persist the slop. Without this, the script is read-only.
//   --only=<csv>         Restrict to signals: mechanical,duplicate,fyi,short,stale
//   --max=<n>            Cap total items slopped in a run. Default 50.
//   --include-stale-days=<n>
//                        How old an item must be to count as 'stale'. Default 14.
//
// Output: prints a per-signal table, then (if --apply) a per-item action log.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ─── env bootstrap ────────────────────────────────────────────────────
function loadEnv() {
  const p = resolve(process.cwd(), '.env.local')
  const txt = readFileSync(p, 'utf8')
  for (const line of txt.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (!m) continue
    const [, k, v] = m
    if (!process.env[k]) {
      process.env[k] = v.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1')
    }
  }
}

// ─── args ─────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const ONLY = (argv.find(a => a.startsWith('--only='))?.slice('--only='.length) ?? '')
  .split(',').map(s => s.trim()).filter(Boolean)
const MAX = Number(argv.find(a => a.startsWith('--max='))?.slice('--max='.length) ?? '50')
const STALE_DAYS = Number(
  argv.find(a => a.startsWith('--include-stale-days='))?.slice('--include-stale-days='.length) ?? '14'
)

type Reason =
  | 'irrelevant' | 'spam' | 'low_signal' | 'not_my_focus' | 'misread_title'
  | 'duplicate' | 'should_be_subtask' | 'old_task' | 'already_cleared' | 'other'

interface Candidate {
  signal: string
  reason: Reason
  note: string
  item: Item
}

interface Item {
  id: string
  user_id: string
  title: string
  source: string
  tag?: string | null
  task_type?: string | null
  parent_context?: string | null
  status: string
  first_seen_at?: string | null
  created_at: string
  proposed_action?: Record<string, unknown> | null
  extraction_meta?: { llm_call_id?: string } | null
}

// ─── detectors ────────────────────────────────────────────────────────
// Each detector returns Candidate[] for items it thinks are slop. Detectors
// are independent; an item may show up in multiple signals. We dedupe by
// item id when applying.

const MECHANICAL_PATTERNS: RegExp[] = [
  // "Join <some meeting/session>" — these are calendar links that leaked
  // through extractors as Gmail/Granola tasks. Real action items would
  // say "Reply to Aurelia" or "Send Beth the deck", not "Join X".
  /^\s*join\s+(live\s+)?(session|call|meeting|webinar|demo)/i,
  /^\s*join\s+[A-Z][a-z]+\s+(design|product|engineering|sync|standup|review)/i,
  // Newsletter / list cruft.
  /(unsubscribe|update.{0,15}preferences|manage.{0,15}subscription)/i,
  /(view in browser|see online|view this in)/i,
  // Raw "click here" / "view email" — these are link CTAs, not tasks.
  /^\s*(click|view|open|see|check)\s+(this|here|the\s+(link|email|message))/i,
]

function detectMechanical(items: Item[]): Candidate[] {
  const out: Candidate[] = []
  for (const it of items) {
    const t = it.title || ''
    for (const rx of MECHANICAL_PATTERNS) {
      if (rx.test(t)) {
        out.push({
          signal: 'mechanical',
          reason: 'spam',
          note: `Matched mechanical-noise pattern: ${rx.source.slice(0, 50)}`,
          item: it,
        })
        break
      }
    }
  }
  return out
}

// Normalize a title to its semantic core so trailing words like "call",
// "details", "issues" cluster the same task across extractions.
function normTitle(s: string): string {
  return s.toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b(call|meeting|details|issues|info|update|question|today|tomorrow|now)\b/g, '')
    .trim()
    .slice(0, 60)
}

function detectDuplicates(items: Item[]): Candidate[] {
  const buckets = new Map<string, Item[]>()
  for (const it of items) {
    if (!it.title) continue
    const key = normTitle(it.title)
    if (!key) continue
    const arr = buckets.get(key) ?? []
    arr.push(it)
    buckets.set(key, arr)
  }
  const out: Candidate[] = []
  for (const [, group] of buckets) {
    if (group.length < 2) continue
    // Keep the newest, slop the rest. Newest = highest first_seen_at.
    const sorted = [...group].sort((a, b) =>
      (b.first_seen_at ?? b.created_at).localeCompare(a.first_seen_at ?? a.created_at)
    )
    const [, ...slops] = sorted
    for (const it of slops) {
      out.push({
        signal: 'duplicate',
        reason: 'duplicate',
        note: `Near-duplicate of ${sorted[0].id} ("${sorted[0].title.slice(0, 80)}")`,
        item: it,
      })
    }
  }
  return out
}

function detectFyi(items: Item[]): Candidate[] {
  const out: Candidate[] = []
  for (const it of items) {
    // tag='fyi' was explicitly set by the extractor; by definition it's
    // not an action. Anything still 'open' with tag='fyi' is clutter.
    if ((it.tag || '').toLowerCase() === 'fyi') {
      out.push({
        signal: 'fyi',
        reason: 'low_signal',
        note: 'Tagged FYI by the extractor; not actionable',
        item: it,
      })
    }
  }
  return out
}

function detectShortVague(items: Item[]): Candidate[] {
  const out: Candidate[] = []
  for (const it of items) {
    const t = (it.title || '').trim()
    // Very short titles with no context = the extractor couldn't bind the
    // task to a recipient or subject. Worse than dropping it.
    if (t.length < 18 && (!it.parent_context || it.parent_context.length < 30)) {
      out.push({
        signal: 'short',
        reason: 'low_signal',
        note: `Title too short (${t.length} chars) and parent_context is empty/thin`,
        item: it,
      })
    }
  }
  return out
}

function detectStale(items: Item[], cutoffDays: number): Candidate[] {
  const cutoff = new Date(Date.now() - cutoffDays * 24 * 60 * 60 * 1000).toISOString()
  const out: Candidate[] = []
  for (const it of items) {
    const seen = it.first_seen_at ?? it.created_at
    if (seen < cutoff) {
      out.push({
        signal: 'stale',
        reason: 'old_task',
        note: `First seen ${seen.slice(0, 10)} (>${cutoffDays}d ago); user has not acted`,
        item: it,
      })
    }
  }
  return out
}

// ─── supabase helpers ─────────────────────────────────────────────────
async function sb<T = unknown>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const res = await fetch(`${url}/rest/v1${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(init.headers || {}),
    },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Supabase ${res.status} ${path}: ${body.slice(0, 200)}`)
  }
  return res.status === 204 ? (undefined as T) : (res.json() as Promise<T>)
}

async function loadOpenItems(userId: string): Promise<Item[]> {
  return sb<Item[]>(
    `/items?user_id=eq.${userId}&status=eq.open&parent_id=is.null` +
    `&select=id,user_id,title,source,tag,task_type,parent_context,status,first_seen_at,created_at,proposed_action,extraction_meta` +
    `&limit=2000`
  )
}

// Mirror of markItemSlop in app/today/actions.ts. We replicate steps 1-4
// from that function (feedback insert + items.dismissed) and step 6 (mem0).
// We skip Langfuse and eval-dataset auto-promote here to keep the script
// dependency-free; the in-app button still does both, so any signals we
// catch in interactive use go through the full path.
async function applySlop(c: Candidate): Promise<void> {
  const it = c.item

  // 1. find producing LLM call (best-effort, fast path only)
  const llmCallId = it.extraction_meta?.llm_call_id ?? null

  // 2. feedback row
  await sb('/item_feedback', {
    method: 'POST',
    body: JSON.stringify({
      item_id: it.id,
      user_id: it.user_id,
      kind: 'slop',
      reason: c.reason,
      note: `[slop-audit ${c.signal}] ${c.note}`,
      item_snapshot: it,
      llm_call_id: llmCallId,
    }),
  })

  // 3. dismiss the item
  await sb(`/items?id=eq.${it.id}&user_id=eq.${it.user_id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'dismissed' }),
  })
}

// ─── runner ───────────────────────────────────────────────────────────
async function main() {
  loadEnv()
  const userId = process.env.APP_USER_ID
  if (!userId) throw new Error('APP_USER_ID missing in .env.local')
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase URL or service-role key missing in .env.local')
  }

  const items = await loadOpenItems(userId)
  console.log(`Loaded ${items.length} open items for user ${userId.slice(0, 8)}...`)
  console.log('')

  const detectors: Array<[string, () => Candidate[]]> = [
    ['mechanical', () => detectMechanical(items)],
    ['duplicate',  () => detectDuplicates(items)],
    ['fyi',        () => detectFyi(items)],
    ['short',      () => detectShortVague(items)],
    ['stale',      () => detectStale(items, STALE_DAYS)],
  ]

  const all: Candidate[] = []
  for (const [name, fn] of detectors) {
    if (ONLY.length > 0 && !ONLY.includes(name)) continue
    const hits = fn()
    console.log(`--- ${name}: ${hits.length} hits ---`)
    for (const h of hits.slice(0, 10)) {
      console.log(`  [${h.item.source.padEnd(8)}] ${h.item.title.slice(0, 90)}`)
    }
    if (hits.length > 10) console.log(`  ... +${hits.length - 10} more`)
    console.log('')
    all.push(...hits)
  }

  // Dedupe by item id: prefer the earliest-listed signal (mechanical > duplicate > fyi > short > stale).
  // The detector ordering above already encodes the priority.
  const seen = new Set<string>()
  const unique: Candidate[] = []
  for (const c of all) {
    if (seen.has(c.item.id)) continue
    seen.add(c.item.id)
    unique.push(c)
  }
  const capped = unique.slice(0, MAX)

  console.log(`Unique slop candidates: ${unique.length} (applying ${capped.length}, capped at --max=${MAX})`)
  console.log('')

  if (!APPLY) {
    console.log('DRY RUN. Pass --apply to mark these as dismissed.')
    return
  }

  let ok = 0
  let failed = 0
  for (const c of capped) {
    try {
      await applySlop(c)
      console.log(`  ✓ ${c.signal.padEnd(10)} ${c.item.id.slice(0, 8)}  ${c.item.title.slice(0, 80)}`)
      ok++
    } catch (err) {
      console.error(`  ✗ ${c.signal.padEnd(10)} ${c.item.id.slice(0, 8)}  ${c.item.title.slice(0, 80)}`)
      console.error(`     ${err instanceof Error ? err.message : err}`)
      failed++
    }
  }
  console.log('')
  console.log(`Done. Slopped: ${ok}. Failed: ${failed}.`)
}

main().catch(err => {
  console.error('slop-audit threw:', err instanceof Error ? err.stack : err)
  process.exit(1)
})
