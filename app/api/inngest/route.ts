// Inngest webhook receiver. This is the endpoint Inngest calls to invoke
// your functions. You register the deployed URL in the Inngest dashboard:
//   https://your-domain.com/api/inngest
//
// In local dev, run `npm run inngest` (the Inngest CLI) and it'll auto-detect
// this route at http://localhost:3000/api/inngest.

import { serve } from 'inngest/next'
import { inngest } from '@/inngest/client'
import { morningDigest } from '@/inngest/functions/morning-digest'
import { gmailPoll } from '@/inngest/functions/gmail-poll'
import { evalCron } from '@/inngest/functions/eval-cron'
import { draftCleanup } from '@/inngest/functions/draft-cleanup'
import { whatsappMorningDigest } from '@/inngest/functions/whatsapp-morning-digest'
import { whatsappMeetingScheduler } from '@/inngest/functions/whatsapp-meeting-scheduler'
import { whatsappMeetingReminder } from '@/inngest/functions/whatsapp-meeting-reminder'

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    morningDigest,
    gmailPoll,
    evalCron,
    draftCleanup,
    whatsappMorningDigest,
    whatsappMeetingScheduler,
    whatsappMeetingReminder,
  ],
  signingKey: process.env.INNGEST_SIGNING_KEY,
})
