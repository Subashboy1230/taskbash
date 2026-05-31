// One-off triage: dismiss open Linear items whose underlying issue is NOT in
// "QA Requested" or "Changes Requested" state.
//
// Dry-run by default. Pass --execute to actually dismiss.
//
//   npx tsx scripts/triage-linear.ts            # preview
//   npx tsx scripts/triage-linear.ts --execute  # dismiss

import { config } from 'dotenv'
config({ path: '.env.local' })

const DRY_RUN = !process.argv.includes('--execute')

async function main() {
  const { createClient } = await import('@supabase/supabase-js')

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const supabase = createClient(url, key)

  // Pull Linear API key from connections table (same as getActiveConnection('linear'))
  const { data: connRow } = await supabase
    .from('connections')
    .select('api_key')
    .eq('provider', 'linear')
    .single()
  const linearApiKey = connRow?.api_key
  if (!linearApiKey) throw new Error('No active Linear connection found in DB')

  // 1. Load all open Linear items
  const { data: items, error } = await supabase
    .from('items')
    .select('id, title, source_ref, status')
    .eq('source', 'linear')
    .in('status', ['open', 'in_progress'])

  if (error) throw new Error(`DB query failed: ${error.message}`)
  console.log(`Found ${items?.length ?? 0} open Linear items in DB`)

  // 2. Collect unique issue IDs from source_ref
  const issueIds = Array.from(
    new Set(
      (items ?? [])
        .map(i => (i.source_ref as any)?.linear_issue_id)
        .filter(Boolean)
    )
  ) as string[]

  console.log(`Fetching ${issueIds.length} issues from Linear API...`)

  // 3. Fetch current state for all issues in one GraphQL query
  const idList = issueIds.map(id => `"${id}"`).join(', ')
  const query = `
    query TriageStates {
      issues(filter: { id: { in: [${idList}] } }) {
        nodes { id identifier title state { name type } }
      }
    }
  `.trim()

  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: linearApiKey },
    body: JSON.stringify({ query }),
  })
  if (!res.ok) throw new Error(`Linear API ${res.status}: ${await res.text()}`)

  const data = await res.json() as {
    data?: { issues?: { nodes?: Array<{ id: string; identifier: string; title: string; state?: { name?: string; type?: string } }> } }
    errors?: Array<{ message: string }>
  }
  if (data.errors?.length) throw new Error(`Linear errors: ${data.errors.map(e => e.message).join('; ')}`)

  const issueMap = new Map(
    (data.data?.issues?.nodes ?? []).map(i => [i.id, i])
  )

  // 4. Allowed states
  const ALLOWED_STATES = new Set(['QA Requested', 'Changes Requested', 'Planned'])
  // Allowed Linear state types (open/active work)
  // We also keep "started" issues that are in allowed name states above

  // 5. Classify each item
  const toKeep: typeof items = []
  const toDismiss: typeof items = []
  const notFound: typeof items = []

  for (const item of items ?? []) {
    const issueId = (item.source_ref as any)?.linear_issue_id
    if (!issueId) { toDismiss.push(item); continue }

    const issue = issueMap.get(issueId)
    if (!issue) { notFound.push(item); continue }

    const stateName = issue.state?.name ?? ''
    const stateType = issue.state?.type ?? ''

    // Keep if state name is in the allowed set
    if (ALLOWED_STATES.has(stateName)) {
      toKeep.push(item)
    } else {
      toDismiss.push(item)
    }
  }

  // 6. Print summary
  console.log(`\n--- KEEP (${toKeep.length}) ---`)
  for (const i of toKeep) {
    const issueId = (i.source_ref as any)?.linear_issue_id
    const issue = issueMap.get(issueId)
    console.log(`  KEEP  [${issue?.identifier}] ${i.title.slice(0, 80)} — state: ${issue?.state?.name}`)
  }

  console.log(`\n--- DISMISS (${toDismiss.length}) ---`)
  for (const i of toDismiss) {
    const issueId = (i.source_ref as any)?.linear_issue_id
    const issue = issueMap.get(issueId)
    const stateLabel = issue ? issue.state?.name ?? '(no state)' : '(not found in Linear)'
    console.log(`  DISMISS  [${issue?.identifier ?? '?'}] ${i.title.slice(0, 80)} — state: ${stateLabel}`)
  }

  if (notFound.length > 0) {
    console.log(`\n--- NOT FOUND IN LINEAR (${notFound.length}) — will dismiss ---`)
    for (const i of notFound) console.log(`  ?  ${i.title.slice(0, 80)}`)
  }

  if (DRY_RUN) {
    console.log(`\nDRY RUN — nothing changed. Run with --execute to dismiss ${toDismiss.length + notFound.length} items.`)
    return
  }

  // 7. Dismiss
  const idsToRemove = [
    ...toDismiss.map(i => i.id),
    ...notFound.map(i => i.id),
  ]
  if (idsToRemove.length === 0) {
    console.log('\nNothing to dismiss.')
    return
  }

  const { error: updateErr } = await supabase
    .from('items')
    .update({ status: 'dismissed', updated_at: new Date().toISOString() })
    .in('id', idsToRemove)

  if (updateErr) throw new Error(`Dismiss failed: ${updateErr.message}`)
  console.log(`\nDismissed ${idsToRemove.length} items.`)
}

main().catch(err => { console.error(err); process.exit(1) })
