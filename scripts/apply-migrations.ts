import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const migrations = ['025_gmail_draft_ids.sql', '026_gmail_draft_blocklist.sql', '027_auto_draft_settings.sql', '028_subtask_role.sql']

async function main() {
  for (const file of migrations) {
    const sql = fs.readFileSync(`migrations/${file}`, 'utf8')
    console.log(`Applying ${file}...`)
    const { error } = await sb.rpc('exec_sql', { sql }).single().catch(() => ({ error: { message: 'rpc not available' } }))
    if (error) {
      // Try direct query via REST
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
        method: 'POST',
        headers: { 'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY!, 'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql })
      })
      console.log(`  ${file}: ${res.status}`)
    } else {
      console.log(`  ${file}: ok`)
    }
  }
}
main().catch(console.error)
