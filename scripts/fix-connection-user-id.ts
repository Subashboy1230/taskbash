// Restore gmail to active after debug script accidentally expired it
import { config } from 'dotenv'
config({ path: '.env.local' })

async function main() {
  const { createClient } = await import('@supabase/supabase-js')
  const sb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  const { data, error } = await sb
    .from('connections')
    .update({ status: 'active' })
    .eq('provider', 'gmail')
    .select('provider, status, user_id')

  console.log('restored:', data)
  if (error) console.error(error)

  const { data: all } = await sb.from('connections').select('provider, status, user_id')
  console.log('\nFinal state:')
  console.table(all)
}
main().catch(console.error)
