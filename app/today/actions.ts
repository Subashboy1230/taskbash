'use server'

// Server Actions for the /today page.
// Each one mutates Supabase + revalidates the page so the UI reflects state.

import { revalidatePath } from 'next/cache'
import { supabase } from '@/lib/supabase'
import { inngest, EVENTS } from '@/inngest/client'

const USER_ID = process.env.APP_USER_ID!

export async function completeItem(itemId: string) {
  const { error } = await supabase
    .from('items')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
    })
    .eq('id', itemId)
    .eq('user_id', USER_ID)
  if (error) throw new Error(`completeItem failed: ${error.message}`)
  revalidatePath('/today')
}

export async function uncompleteItem(itemId: string) {
  const { error } = await supabase
    .from('items')
    .update({ status: 'open', completed_at: null })
    .eq('id', itemId)
    .eq('user_id', USER_ID)
  if (error) throw new Error(`uncompleteItem failed: ${error.message}`)
  revalidatePath('/today')
}

export async function dismissItem(itemId: string) {
  const { error } = await supabase
    .from('items')
    .update({ status: 'dismissed' })
    .eq('id', itemId)
    .eq('user_id', USER_ID)
  if (error) throw new Error(`dismissItem failed: ${error.message}`)
  revalidatePath('/today')
}

export async function requestRefresh(): Promise<{ ok: boolean; error?: string }> {
  // A failed Inngest send must NOT crash the /today page. Catch and report.
  try {
    await inngest.send({
      name: EVENTS.digestRequested,
      data: { source: 'ui_refresh', requested_at: new Date().toISOString() },
    })
    return { ok: true }
  } catch (err) {
    console.error('requestRefresh failed:', err)
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}
