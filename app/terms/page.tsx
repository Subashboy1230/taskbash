import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Terms of Use — taskbash',
}

const LAST_UPDATED = 'May 31, 2026'

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-canvas px-6 py-16">
      <div className="mx-auto max-w-2xl">
        <div className="mb-10">
          <Link href="/login" className="text-[13px] text-ink-faint hover:text-ink">
            ← taskbash
          </Link>
        </div>

        <h1 className="m-0 text-[28px] font-semibold tracking-tight text-ink">
          Terms of Use
        </h1>
        <p className="mt-2 text-[13px] text-ink-faint">Last updated: {LAST_UPDATED}</p>

        <div className="mt-10 space-y-8 text-[14px] leading-relaxed text-ink-muted">

          <section>
            <h2 className="mb-3 text-[15px] font-semibold text-ink">The service</h2>
            <p>
              taskbash is a personal productivity tool operated by Subash Rajaseelan
              (&ldquo;we&rdquo;, &ldquo;us&rdquo;). It is available at{' '}
              <a
                href="https://taskbash.app"
                className="text-ink underline hover:text-ink-muted"
              >
                taskbash.app
              </a>
              . By accessing or using taskbash, you agree to these Terms of Use.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-[15px] font-semibold text-ink">Beta &amp; eligibility</h2>
            <p>
              taskbash is currently in private beta. Access is by invitation only. The service is
              intended for personal, non-commercial use. You must be at least 18 years old to use
              taskbash.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-[15px] font-semibold text-ink">Your account</h2>
            <p>
              You sign in with Google OAuth. You are responsible for all activity that occurs under
              your account. Do not share your account with others.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-[15px] font-semibold text-ink">
              Connected accounts and permissions
            </h2>
            <p>
              When you connect Gmail, Google Calendar, Granola, or Linear, you grant taskbash
              permission to access those accounts as described in the{' '}
              <Link href="/privacy" className="text-ink underline hover:text-ink-muted">
                Privacy Policy
              </Link>
              . You can revoke access at any time by disconnecting sources in{' '}
              <Link href="/connections" className="text-ink underline hover:text-ink-muted">
                Settings
              </Link>{' '}
              or directly via your Google account permissions page. taskbash will only request
              scopes necessary to provide the features you use.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-[15px] font-semibold text-ink">Acceptable use</h2>
            <p className="mb-2">You agree not to:</p>
            <ul className="space-y-2 pl-4">
              <li>Use taskbash for commercial purposes or resell access to others.</li>
              <li>Attempt to scrape, reverse-engineer, or abuse the service programmatically.</li>
              <li>Use taskbash to send unsolicited email or spam via the Gmail draft feature.</li>
              <li>
                Attempt to access other users&apos; data or circumvent authentication controls.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-[15px] font-semibold text-ink">AI-generated content</h2>
            <p>
              taskbash uses Anthropic&apos;s Claude AI to generate task summaries, email draft
              replies, and meeting prep briefs. AI-generated content may be inaccurate, incomplete,
              or unsuitable for your situation. You are responsible for reviewing all AI-generated
              content — including email drafts — before acting on it or sending it. taskbash is not
              liable for decisions made based on AI output.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-[15px] font-semibold text-ink">
              No warranty
            </h2>
            <p>
              taskbash is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo; without
              warranty of any kind. We make no guarantee of uptime, data accuracy, or fitness for
              any particular purpose, especially during beta. We reserve the right to modify,
              suspend, or discontinue the service at any time without notice.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-[15px] font-semibold text-ink">Limitation of liability</h2>
            <p>
              To the fullest extent permitted by law, Subash Rajaseelan shall not be liable for any
              indirect, incidental, or consequential damages arising from your use of taskbash,
              including but not limited to data loss, missed tasks, or incorrect email drafts sent
              on your behalf.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-[15px] font-semibold text-ink">Third-party services</h2>
            <p>
              taskbash integrates with Google, Granola, Linear, Anthropic, Supabase, and Nango.
              Your use of those services is governed by their respective terms and privacy policies.
              taskbash is not affiliated with or endorsed by any of these companies.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-[15px] font-semibold text-ink">Changes to these terms</h2>
            <p>
              We may update these terms from time to time. The &ldquo;Last updated&rdquo; date at
              the top reflects the most recent revision. Continued use of taskbash after a change
              constitutes your acceptance of the new terms.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-[15px] font-semibold text-ink">Governing law</h2>
            <p>
              These terms are governed by the laws of the State of California, without regard to
              conflict of law principles.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-[15px] font-semibold text-ink">Contact</h2>
            <p>
              Questions?{' '}
              <a
                href="mailto:subashraj411@gmail.com"
                className="text-ink underline hover:text-ink-muted"
              >
                subashraj411@gmail.com
              </a>
            </p>
          </section>
        </div>

        <div className="mt-16 border-t border-line pt-6 text-[12px] text-ink-faint">
          <div className="flex items-center justify-between">
            <span>© {new Date().getFullYear()} Subash Rajaseelan. All rights reserved.</span>
            <Link href="/privacy" className="hover:text-ink">
              Privacy Policy →
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
