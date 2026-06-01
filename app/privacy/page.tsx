import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Privacy Policy — taskbash',
}

const LAST_UPDATED = 'May 31, 2026'

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-canvas px-6 py-16">
      <div className="mx-auto max-w-2xl">
        <div className="mb-10">
          <Link href="/login" className="text-[13px] text-ink-faint hover:text-ink">
            ← taskbash
          </Link>
        </div>

        <h1 className="m-0 text-[28px] font-semibold tracking-tight text-ink">
          Privacy Policy
        </h1>
        <p className="mt-2 text-[13px] text-ink-faint">Last updated: {LAST_UPDATED}</p>

        <div className="mt-10 space-y-8 text-[14px] leading-relaxed text-ink-muted">

          <section>
            <h2 className="mb-3 text-[15px] font-semibold text-ink">What is taskbash?</h2>
            <p>
              taskbash is a personal productivity tool operated by Subash Rajaseelan. It connects
              to your work tools — Gmail, Google Calendar, Granola, and Linear — and produces a
              daily digest of action items and meeting prep briefs. taskbash is currently in private
              beta and is intended for personal use only.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-[15px] font-semibold text-ink">What data we access</h2>
            <p className="mb-3">
              taskbash requests read access to the following sources when you connect them in
              Settings:
            </p>
            <ul className="space-y-2 pl-4">
              <li>
                <span className="font-medium text-ink">Gmail</span> — reads your inbox threads to
                identify action items and reply tasks. With your explicit approval, taskbash can
                also create and send draft replies on your behalf via the Gmail API.
              </li>
              <li>
                <span className="font-medium text-ink">Google Calendar</span> — reads your upcoming
                calendar events to generate meeting prep briefs for multi-attendee meetings.
              </li>
              <li>
                <span className="font-medium text-ink">Granola</span> — reads your meeting notes
                via the Granola public API to provide context for meeting prep and post-call
                action items.
              </li>
              <li>
                <span className="font-medium text-ink">Linear</span> — reads your assigned issues
                to surface relevant work items in your digest.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-[15px] font-semibold text-ink">How your data is used</h2>
            <ul className="space-y-2 pl-4">
              <li>To generate your daily task digest and action items.</li>
              <li>To draft email replies and meeting prep briefs using AI.</li>
              <li>To send Gmail drafts you explicitly approve in the taskbash interface.</li>
            </ul>
            <p className="mt-3">
              Your data is <span className="font-medium text-ink">never sold</span>, never shared
              with third parties for advertising, and never used to train AI models.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-[15px] font-semibold text-ink">AI processing</h2>
            <p>
              Email content, meeting notes, and calendar details are sent to{' '}
              <span className="font-medium text-ink">Anthropic&apos;s Claude API</span> to generate
              summaries, task extractions, and reply drafts. Anthropic&apos;s API operates under a
              zero-data-retention policy — content sent via the API is not stored or used to train
              models. See{' '}
              <a
                href="https://www.anthropic.com/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-ink underline hover:text-ink-muted"
              >
                Anthropic&apos;s Privacy Policy
              </a>{' '}
              for details.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-[15px] font-semibold text-ink">Data storage</h2>
            <p>
              Your task items, connection preferences, and account data are stored in a hosted
              Postgres database (Supabase). OAuth tokens for Gmail and Google Calendar are managed
              by Nango, a third-party OAuth infrastructure provider. No raw email or meeting content
              is stored permanently — only the extracted action items and generated briefs.
            </p>
          </section>

          <section className="rounded-lg border border-line bg-surface px-4 py-4">
            <h2 className="mb-2 text-[15px] font-semibold text-ink">
              Google API Services — Limited Use Disclosure
            </h2>
            <p>
              taskbash&apos;s use and transfer of information received from Google APIs adheres to
              the{' '}
              <a
                href="https://developers.google.com/terms/api-services-user-data-policy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-ink underline hover:text-ink-muted"
              >
                Google API Services User Data Policy
              </a>
              , including the Limited Use requirements.
            </p>
            <p className="mt-2">
              Specifically: data received from Google APIs is used only to provide and improve
              taskbash&apos;s features as described above. It is not used for serving ads, is not
              shared with humans except as needed to provide the service, and access is limited to
              what is strictly required.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-[15px] font-semibold text-ink">Data retention</h2>
            <p>
              Your task data is retained until you delete your account. Gmail and Calendar OAuth
              tokens can be revoked at any time via your{' '}
              <a
                href="https://myaccount.google.com/permissions"
                target="_blank"
                rel="noopener noreferrer"
                className="text-ink underline hover:text-ink-muted"
              >
                Google account permissions
              </a>
              . Disconnecting a source in taskbash&apos;s Settings page removes the associated
              token from Nango.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-[15px] font-semibold text-ink">Your rights</h2>
            <p>
              You can access, export, or delete your data via the{' '}
              <Link href="/profile" className="text-ink underline hover:text-ink-muted">
                /profile
              </Link>{' '}
              page, or by emailing{' '}
              <a href="mailto:subashraj411@gmail.com" className="text-ink underline hover:text-ink-muted">
                subashraj411@gmail.com
              </a>
              . Account deletion removes all stored task items, connection credentials, and
              associated data.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-[15px] font-semibold text-ink">Changes to this policy</h2>
            <p>
              This policy may be updated from time to time. The &ldquo;Last updated&rdquo; date at
              the top reflects the most recent revision. Continued use of taskbash after a policy
              change constitutes acceptance of the updated terms.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-[15px] font-semibold text-ink">Contact</h2>
            <p>
              Questions about this policy? Email{' '}
              <a href="mailto:subashraj411@gmail.com" className="text-ink underline hover:text-ink-muted">
                subashraj411@gmail.com
              </a>
              .
            </p>
          </section>
        </div>

        <div className="mt-16 border-t border-line pt-6 text-[12px] text-ink-faint">
          <div className="flex items-center justify-between">
            <span>© {new Date().getFullYear()} Subash Rajaseelan. All rights reserved.</span>
            <Link href="/terms" className="hover:text-ink">
              Terms of Use →
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
