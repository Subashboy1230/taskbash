import { config } from 'dotenv'
config({ path: '.env.local' })

async function main() {
  const { createClient } = await import('@supabase/supabase-js')

  const sb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  // Show all connections with their user_ids
  const { data: conns } = await sb
    .from('connections')
    .select('id, user_id, provider, status, nango_connection_id, api_key, created_at')
    .order('created_at', { ascending: false })

  console.log('APP_USER_ID:', process.env.APP_USER_ID)
  console.log('\nAll connections rows:')
  for (const r of conns ?? []) {
    console.log(`  provider=${r.provider} status=${r.status} user_id=${r.user_id} nango=${(r.nango_connection_id ?? '').slice(0,20)} api_key=${r.api_key ? 'SET' : 'null'}`)
  }

  // Show all users
  const { data: users } = await sb.from('users').select('id, email').limit(10)
  console.log('\nUsers in DB:')
  for (const u of users ?? []) {
    console.log(`  id=${u.id} email=${u.email}`)
  }

  // Show auth.users
  const { data: authUsers } = await sb.auth.admin.listUsers()
  console.log('\nAuth users:')
  for (const u of authUsers?.users ?? []) {
    console.log(`  id=${u.id} email=${u.email}`)
  }
}

main().catch(console.error)
