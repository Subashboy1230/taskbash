import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

sb.from('items').select('id, title, source_ref, source_excerpt, parent_context')
  .eq('task_type', 'context_prep').eq('status', 'open').limit(5)
  .then(({ data }) => {
    for (const item of data ?? []) {
      console.log('\n---', item.title)
      console.log('source_ref:', JSON.stringify(item.source_ref))
      console.log('parent_context:', item.parent_context?.slice(0, 300))
      console.log('source_excerpt:', item.source_excerpt?.slice(0, 400))
    }
  })
