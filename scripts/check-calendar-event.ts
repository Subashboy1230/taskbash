import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

async function main() {
  const { nangoProxy } = await import('../lib/nango')
  const { NANGO_PROVIDER_KEY } = await import('../lib/connections')
  const { supabase } = await import('../lib/supabase')
  
  const connectionId = '55493ae1-e8ed-47b6-9741-108b1d5131e7'
  
  // Get all open prep items with no meeting_url
  const { data: items } = await supabase.from('items')
    .select('id, title, source_ref').eq('task_type', 'context_prep').eq('status', 'open')
  
  for (const item of items ?? []) {
    const ref = item.source_ref as any
    if (ref?.meeting_url) { console.log('already has url:', item.title); continue }
    const eventId = ref?.google_calendar_event_id
    if (!eventId) continue
    try {
      const event = await nangoProxy<any>({
        providerConfigKey: NANGO_PROVIDER_KEY.calendar!,
        connectionId,
        method: 'GET',
        endpoint: `/calendar/v3/calendars/primary/events/${eventId}`,
      })
      if (event.hangoutLink) {
        await supabase.from('items').update({ source_ref: { ...ref, meeting_url: event.hangoutLink } }).eq('id', item.id)
        console.log('updated:', item.title, '->', event.hangoutLink)
      } else {
        console.log('no link:', item.title)
      }
    } catch(e: any) { console.log('error:', item.title, e.message) }
  }
}
main().catch(console.error)
