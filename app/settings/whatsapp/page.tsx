// /settings/whatsapp — connect a WhatsApp number, toggle digest + reminders,
// set digest time + quiet hours, send a test, opt out.

import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getWhatsAppSettings } from '@/lib/whatsapp'
import { WhatsAppSettingsForm } from './whatsapp-settings-form'

export const dynamic = 'force-dynamic'

export default async function WhatsAppSettingsPage() {
  const sb = await createSupabaseServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) redirect('/login?next=/settings/whatsapp')

  const settings = await getWhatsAppSettings(user.id)

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-semibold text-ink">WhatsApp notifications</h1>
      <p className="mt-2 text-sm text-ink-muted">
        Get a morning digest and 10-minute pre-meeting reminders on WhatsApp.
        Reply STOP at any time to opt out.
      </p>

      <WhatsAppSettingsForm initial={settings} />

      <section className="mt-10 border-t border-line pt-6 text-xs text-ink-faint">
        <h2 className="text-sm font-medium text-ink-muted">How it works</h2>
        <ul className="mt-2 space-y-1">
          <li>Morning digest fires daily at your chosen time in your timezone.</li>
          <li>Meeting reminders fire ~10 minutes before each Google Calendar event.</li>
          <li>Both honor your quiet hours window.</li>
          <li>WhatsApp messages use Meta-approved templates. Reply STOP to stop, START to resume.</li>
        </ul>
      </section>
    </main>
  )
}
