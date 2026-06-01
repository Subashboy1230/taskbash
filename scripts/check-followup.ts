import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const USER = 'd470e729-29eb-41bb-8785-9dddedbe8597'

async function main() {
  // Check how many items have a proposed_action from granola
  const { data, count } = await sb.from('items')
    .select('id, title, source, proposed_action, status', { count: 'exact' })
    .eq('user_id', USER)
    .eq('source', 'granola')
    .not('proposed_action', 'is', null)
    .limit(5)
  console.log(`Granola items with proposed_action: ${count}`)
  console.log(data?.map(r => `${r.title.slice(0,50)} | ${r.status} | ${JSON.stringify(r.proposed_action)?.slice(0,80)}`))

  // Check how many granola items total
  const { count: total } = await sb.from('items').select('*', { count: 'exact', head: true }).eq('user_id', USER).eq('source', 'granola')
  console.log(`\nTotal granola items: ${total}`)

  // Check llm_calls for draft.followup — what's in the output?
  const { data: calls } = await sb.from('llm_calls')
    .select('id, output_content, created_at, cost_usd')
    .eq('prompt_id', 'draft.followup')
    .order('created_at', { ascending: false })
    .limit(3)
  console.log(`\nRecent draft.followup outputs:`)
  calls?.forEach(c => {
    const text = typeof c.output_content === 'string' ? c.output_content : JSON.stringify(c.output_content)
    console.log(`  $${c.cost_usd?.toFixed(4)} | ${text?.slice(0, 150)}`)
  })
}
main().catch(console.error)
