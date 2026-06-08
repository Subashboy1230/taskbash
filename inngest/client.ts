import { Inngest, InngestMiddleware } from 'inngest'
import * as Sentry from '@sentry/nextjs'

// Captures any function/step error to Sentry without altering the result, so
// Inngest's retry behavior is untouched. transformOutput fires for every step
// and for the final function output; we only report when an error is present.
// flush() is awaited because Inngest runs in serverless functions that may
// freeze before the event is delivered.
const sentryMiddleware = new InngestMiddleware({
  name: 'Sentry error capture',
  init() {
    return {
      onFunctionRun({ fn }) {
        const fnName = (fn as { name?: string })?.name ?? 'unknown'
        return {
          async transformOutput({ result }) {
            if (result.error) {
              Sentry.captureException(result.error, {
                tags: { inngest_function: fnName },
              })
              await Sentry.flush(2000)
            }
          },
        }
      },
    }
  },
})

export const inngest = new Inngest({
  id: 'cos-app',
  eventKey: process.env.INNGEST_EVENT_KEY,
  middleware: [sentryMiddleware],
})

// Event names - centralized so we don't typo them.
export const EVENTS = {
  digestRequested: 'digest/requested',      // manual trigger
  granolaExtracted: 'granola/extracted',    // upstream signal for chained flows later
  gmailPollRequested: 'gmail/poll.requested',
  evalsRequested: 'evals/requested',        // manual eval-cron trigger
  whatsappMorningDigestRequested: 'whatsapp/morning-digest.requested',
  whatsappMeetingReminderRequested: 'whatsapp/meeting-reminder.requested',
} as const
