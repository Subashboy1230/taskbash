import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function main() {
  // Count open granola items with proposed_action
  const USER = 'd470e729-29eb-41bb-8785-9dddedbe8597'
  const { count: openWithDraft } = await sb.from('items')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', USER).eq('source', 'granola')
    .in('status', ['open', 'in_progress'])
    .not('proposed_action', 'is', null)
  
  const { count: openNoDraft } = await sb.from('items')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', USER).eq('source', 'granola')
    .in('status', ['open', 'in_progress'])
    .is('proposed_action', null)

  console.log(`Open granola with draft: ${openWithDraft}`)
  console.log(`Open granola without draft: ${openNoDraft}`)

  // Check what draftFollowup returns - look at the actual output
  const { data: calls } = await sb.from('llm_calls')
    .select('prompt_id, output_content, created_at')
    .ilike('prompt_id', '%followup%')
    .order('created_at', { ascending: false })
    .limit(3)
  console.log('\nllm_calls matching followup:', calls?.length)
  calls?.forEach(c => {
    const text = typeof c.output_content === 'string' ? c.output_content : JSON.stringify(c.output_content)
    console.log(`  ${c.prompt_id} | ${text?.slice(0,200)}`)
  })

  // Check what outcome B looks like - count discarded followups
  const { data: recentCalls } = await sb.from('llm_calls')
    .select('prompt_id, output_content')
    .eq('prompt_id', 'draft.followup')
    .order('created_at', { ascending: false })
    .limit(10)
  console.log('\ndraft.followup calls found:', recentCalls?.length)
  recentCalls?.forEach(c => {
    const text = typeof c.output_content === 'string' ? c.output_content : JSON.stringify(c.output_content)
    // Look for outcome A vs B
    const outcome = text?.includes('"outcome":"A"') || text?.includes('"outcome": "A"') ? 'A(draft)' : 'B(skip)'
    console.log(`  ${outcome} | ${text?.slice(0,100)}`)
  })
}
main().catch(console.error)
