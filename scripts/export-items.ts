// scripts/export-items.ts
//
// Dump every task taskbash has ever captured for the configured user
// into a markdown file on the Desktop. Useful for portfolio / archive /
// "show me everything the agent ever surfaced."
//
// Usage:
//   npx tsx scripts/export-items.ts
//
// Output: ~/Desktop/taskbash-items-<date>.md  (and .csv)
//
// Groups by source, then by status. Each item: title, status, priority,
// when it was created, the source context that produced it, and the
// proposed action (Gmail draft, etc.) if any.

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { homedir } from 'node:os'

function loadEnv() {
  const p = resolve(process.cwd(), '.env.local')
  const txt = readFileSync(p, 'utf8')
  for (const line of txt.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (!m) continue
    const [, k, v] = m
    if (!process.env[k]) {
      // Strip surrounding double or single quotes (vercel env pull wraps values).
      const stripped = v.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1')
      process.env[k] = stripped
    }
  }
}

interface Item {
  id: string
  title: string
  source: string
  task_type: string | null
  status: string
  priority: string | null
  due_at: string | null
  created_at: string
  completed_at: string | null
  parent_context: string | null
  source_ref: Record<string, unknown> | null
  function_ids: string[] | null
  proposed_action: Record<string, unknown> | null
  tag: string | null
}

async function main() {
  loadEnv()
  const userId = process.env.APP_USER_ID
  if (!userId) {
    console.error('APP_USER_ID missing in .env.local')
    process.exit(1)
  }

  const { supabase } = await import('@/lib/supabase')

  console.log(`Pulling items for user ${userId}...`)
  const { data: items, error } = await supabase
    .from('items')
    .select('id, title, source, task_type, status, priority, due_at, created_at, completed_at, parent_context, source_ref, function_ids, proposed_action, tag')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Supabase query failed:', error.message)
    process.exit(2)
  }
  if (!items || items.length === 0) {
    console.error('No items found.')
    process.exit(0)
  }
  console.log(`Got ${items.length} items.`)

  // Function name lookup
  const { data: functions } = await supabase
    .from('user_functions')
    .select('id, name')
    .eq('user_id', userId)
  const fnNameById = new Map<string, string>(
    (functions ?? []).map(f => [f.id as string, f.name as string])
  )

  const list = items as Item[]
  const today = new Date().toISOString().slice(0, 10)
  const mdPath = join(homedir(), 'Desktop', `taskbash-items-${today}.md`)
  const csvPath = join(homedir(), 'Desktop', `taskbash-items-${today}.csv`)

  writeFileSync(mdPath, renderMarkdown(list, fnNameById))
  writeFileSync(csvPath, renderCsv(list, fnNameById))

  console.log(`\nWrote:\n  ${mdPath}\n  ${csvPath}`)
  console.log('\nSummary by source:')
  const bySource: Record<string, number> = {}
  for (const i of list) bySource[i.source] = (bySource[i.source] ?? 0) + 1
  for (const [src, n] of Object.entries(bySource).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${src.padEnd(12)} ${n}`)
  }
}

function renderMarkdown(items: Item[], fnNameById: Map<string, string>): string {
  const lines: string[] = []
  lines.push(`# taskbash — captured items export`)
  lines.push('')
  lines.push(`Total: ${items.length} items`)
  lines.push(`Exported: ${new Date().toISOString()}`)
  lines.push('')

  // Summary stats
  const stats = {
    open: items.filter(i => i.status === 'open').length,
    completed: items.filter(i => i.status === 'completed').length,
    dismissed: items.filter(i => i.status === 'dismissed').length,
    snoozed: items.filter(i => i.status === 'snoozed').length,
  }
  lines.push(`## Summary`)
  lines.push(``)
  lines.push(`| Status | Count |`)
  lines.push(`|---|---|`)
  for (const [k, v] of Object.entries(stats)) {
    lines.push(`| ${k} | ${v} |`)
  }
  lines.push('')

  // Group by source
  const bySource: Record<string, Item[]> = {}
  for (const i of items) {
    if (!bySource[i.source]) bySource[i.source] = []
    bySource[i.source].push(i)
  }
  const sources = Object.keys(bySource).sort((a, b) => bySource[b].length - bySource[a].length)

  for (const source of sources) {
    lines.push(`## ${source} (${bySource[source].length} items)`)
    lines.push('')
    for (const item of bySource[source]) {
      const statusEmoji =
        item.status === 'completed' ? '✅' :
        item.status === 'dismissed' ? '❌' :
        item.status === 'snoozed' ? '⏰' :
        '⬜'
      const pri = item.priority ? ` [${item.priority}]` : ''
      const created = item.created_at.slice(0, 10)
      const fns = (item.function_ids ?? [])
        .map(id => fnNameById.get(id))
        .filter(Boolean)
        .join(', ')
      const fnLabel = fns ? ` _(${fns})_` : ''
      lines.push(`### ${statusEmoji} ${item.title}${pri}${fnLabel}`)
      lines.push(`*${item.task_type ?? 'task'} · ${item.status} · created ${created}*`)
      if (item.parent_context) {
        const ctx = item.parent_context.slice(0, 240).replace(/\n+/g, ' ').trim()
        lines.push('')
        lines.push(`> ${ctx}${item.parent_context.length > 240 ? '...' : ''}`)
      }
      if (item.proposed_action) {
        const act = item.proposed_action as { kind?: string; gmail_draft_id?: string }
        if (act.kind) {
          lines.push('')
          lines.push(`Proposed: \`${act.kind}\`${act.gmail_draft_id ? ` (draft \`${String(act.gmail_draft_id).slice(0, 12)}...\`)` : ''}`)
        }
      }
      lines.push('')
    }
  }

  return lines.join('\n')
}

function renderCsv(items: Item[], fnNameById: Map<string, string>): string {
  const cols = ['created_at', 'source', 'task_type', 'status', 'priority', 'title', 'functions', 'parent_context']
  const escape = (v: unknown) => {
    const s = String(v ?? '').replace(/\n/g, ' ').replace(/"/g, '""')
    return /[",]/.test(s) ? `"${s}"` : s
  }
  const rows: string[] = [cols.join(',')]
  for (const item of items) {
    const fns = (item.function_ids ?? [])
      .map(id => fnNameById.get(id))
      .filter(Boolean)
      .join('; ')
    rows.push(
      [
        escape(item.created_at),
        escape(item.source),
        escape(item.task_type ?? ''),
        escape(item.status),
        escape(item.priority ?? ''),
        escape(item.title),
        escape(fns),
        escape((item.parent_context ?? '').slice(0, 240)),
      ].join(',')
    )
  }
  return rows.join('\n')
}

main().catch(err => {
  console.error('main() threw:', err instanceof Error ? err.stack : err)
  process.exit(99)
})
