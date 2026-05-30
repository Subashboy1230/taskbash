import { Inngest } from 'inngest'

export const inngest = new Inngest({
  id: 'cos-app',
  eventKey: process.env.INNGEST_EVENT_KEY,
})

// Event names - centralized so we don't typo them.
export const EVENTS = {
  digestRequested: 'digest/requested',      // manual trigger
  granolaExtracted: 'granola/extracted',    // upstream signal for chained flows later
  gmailPollRequested: 'gmail/poll.requested',
} as const
