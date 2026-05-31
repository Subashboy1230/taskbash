import { inngest } from '../client'
import { supabase } from '@/lib/supabase'

export const draftCleanup = inngest.createFunction(
  { id: 'draft-cleanup', name: 'Draft cleanup' },
  [{ cron: '0 4 * * *' }],
  async ({ step }) => {
    const stale = await step.run('find-stale-drafts', async () => {
      const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
      const { data } = await supabase
        .from('items')
        .select('id, gmail_draft_id, user_id')
        .not('gmail_draft_id', 'is', null)
        .eq('status', 'open')
        .lt('created_at', cutoff)
      return data ?? []
    })

    for (const row of stale as { id: string; gmail_draft_id: string; user_id: string }[]) {
      await step.run(`delete-draft-${row.id}`, async () => {
        try {
          const { deleteGmailDraft } = await import('@/lib/gmail/drafts')
          await deleteGmailDraft(row.gmail_draft_id)
        } catch {
          // Non-fatal — draft may already be gone
        }
        await supabase
          .from('items')
          .update({
            gmail_draft_id: null,
            draft_expired_at: new Date().toISOString(),
          })
          .eq('id', row.id)
      })
    }

    return { cleaned: stale.length }
  }
)
