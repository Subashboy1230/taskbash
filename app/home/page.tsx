// /home: public marketing landing page.
//
// Server Component. Uses the same design tokens (canvas / surface / ink /
// line / accent) as the app, and the same Card primitive so the visual
// vocabulary is consistent between marketing and product. No client JS
// except where strictly needed (none here).
//
// Sections, in order:
//   1. Top nav (wordmark + Sign in)
//   2. Hero (headline + subhead + CTA + visual preview of a /today row)
//   3. Sources strip (Gmail, Granola, Calendar, Linear, Slack)
//   4. How it works (3 steps)
//   5. What it does (feature grid, 6 cards)
//   6. The slop loop (the differentiator)
//   7. Stack (technologies the agent runs on)
//   8. Final CTA
//   9. Footer
//
// To make /home public, add 'home' to the middleware public-route list (see
// the comment block above PUBLIC_ROUTES in middleware.ts).

import Link from 'next/link'
import {
  ArrowRight,
  Mail,
  Calendar as CalIcon,
  MessageSquare,
  Sparkles,
  Brain,
  CheckCircle2,
  ChevronRight,
  Zap,
  ListTodo,
  Repeat,
  TrendingDown,
} from 'lucide-react'
import { Card, CardContent } from '@/app/_components/ui/card'
import { BrandLogo } from '@/app/_components/brand-logo'

export const dynamic = 'force-static'

export const metadata = {
  title: 'taskbash · never miss a task, never track one either',
  description:
    'taskbash auto-captures every commitment you make across Gmail, meetings, Linear, and Calendar into one daily list. It learns what matters to you so the list stays clean. No manual tracking.',
}

export default function HomePage() {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <TopNav />
      <Hero />
      <SourcesStrip />
      <HowItWorks />
      <FeatureGrid />
      <SlopLoopSection />
      <StackSection />
      <FinalCTA />
      <Footer />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// 1. Top nav

function TopNav() {
  return (
    <header className="sticky top-0 z-30 border-b border-line/60 bg-canvas/80 backdrop-blur supports-[backdrop-filter]:bg-canvas/60">
      <div className="mx-auto flex h-14 max-w-[1100px] items-center justify-between px-6">
        <Link href="/home" className="inline-flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-new.png" alt="taskbash" width={22} height={22} />
          <span className="text-[16px] font-semibold tracking-tight text-ink">taskbash</span>
        </Link>
        <nav className="flex items-center gap-1 text-[13px]">
          <a href="#how" className="rounded-md px-3 py-1.5 text-ink-muted hover:text-ink">How it works</a>
          <a href="#features" className="rounded-md px-3 py-1.5 text-ink-muted hover:text-ink">Features</a>
          <a href="#learning" className="rounded-md px-3 py-1.5 text-ink-muted hover:text-ink">Learning loop</a>
          <Link
            href="/login"
            className="ml-2 inline-flex items-center gap-1.5 rounded-md bg-accent px-3.5 py-1.5 text-[13px] font-medium text-primary-foreground hover:bg-accent-strong"
          >
            Sign in
            <ArrowRight size={13} />
          </Link>
        </nav>
      </div>
    </header>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// 2. Hero

function Hero() {
  return (
    <section className="mx-auto max-w-[1100px] px-6 pt-20 pb-16 md:pt-28 md:pb-20">
      <div className="grid items-center gap-12 md:grid-cols-[1.1fr_0.9fr]">
        <div className="animate-fade-in-up">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider text-ink-muted">
            <Sparkles size={12} className="text-ink" />
            AI chief of staff
          </span>
          <h1 className="mt-5 m-0 text-[44px] font-semibold leading-[1.05] tracking-tight text-ink md:text-[56px]">
            Never miss a task.
            <br />
            <span className="text-ink-muted">Never track one either.</span>
          </h1>
          <p className="mt-5 max-w-[520px] text-[16px] leading-relaxed text-ink-muted md:text-[17px]">
            taskbash pulls every commitment you make across Gmail, meetings,
            Linear, and Calendar into one ranked daily list. It drafts your
            replies, preps you for meetings, and learns your priorities. The
            list stays clean without you managing it.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/login"
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-3 text-[15px] font-medium text-primary-foreground hover:bg-accent-strong"
            >
              Get organized in 60 seconds
              <ArrowRight size={15} />
            </Link>
            <a
              href="#how"
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-5 py-3 text-[15px] font-medium text-ink-muted hover:text-ink"
            >
              See how it works
              <ChevronRight size={14} />
            </a>
          </div>
          <p className="mt-4 text-[12px] text-ink-faint">
            Free to start. Sign in with Google. Cancel anytime.
          </p>
        </div>

        <div className="md:pl-4">
          <HeroPreviewCard />
        </div>
      </div>
    </section>
  )
}

// A scaled-down preview of a /today row so the visual is honest about what
// the product actually looks like. Static markup, no real data.
function HeroPreviewCard() {
  return (
    <Card className="overflow-hidden border-line bg-surface shadow-2xl shadow-black/40">
      <CardContent className="p-0">
        <div className="flex items-center gap-2 border-b border-line bg-surface-muted/40 px-4 py-2.5">
          <div className="size-2 rounded-full bg-[#ff5f57]" />
          <div className="size-2 rounded-full bg-[#febc2e]" />
          <div className="size-2 rounded-full bg-[#28c840]" />
          <span className="ml-3 text-[11px] font-medium text-ink-faint">taskbash · today</span>
        </div>
        <div className="px-4 py-4">
          <p className="m-0 text-[12px] font-semibold uppercase tracking-wider text-ink-faint">
            P0 · Critical · 3
          </p>
          <ul className="mt-3 list-none space-y-2.5 p-0">
            <PreviewRow
              tag="P0"
              source="gmail"
              title="Reply to Aurelia re: late-June pilot timing"
              meta="Draft ready"
              metaTone="commit"
            />
            <PreviewRow
              tag="P0"
              source="granola"
              title="Send Beth the meeting link"
              meta="From: 30 min with Subash (Beth Starr)"
            />
            <PreviewRow
              tag="P1"
              source="calendar"
              title="Prep: GTM sync"
              meta="11:00 PM today · 4 attendees"
              metaTone="reply"
            />
          </ul>
        </div>
      </CardContent>
    </Card>
  )
}

function PreviewRow({
  tag,
  source,
  title,
  meta,
  metaTone,
}: {
  tag: 'P0' | 'P1' | 'P2'
  source: 'gmail' | 'granola' | 'calendar' | 'linear'
  title: string
  meta: string
  metaTone?: 'reply' | 'commit'
}) {
  const sourceColor =
    source === 'gmail'
      ? 'bg-[#ea4335]'
      : source === 'granola'
      ? 'bg-[#a3e635]'
      : source === 'calendar'
      ? 'bg-[#4285f4]'
      : 'bg-[#5e6ad2]'
  const metaClass =
    metaTone === 'commit'
      ? 'bg-tag-commit-bg text-tag-commit-fg'
      : metaTone === 'reply'
      ? 'bg-tag-reply-bg text-tag-reply-fg'
      : 'text-ink-faint'
  return (
    <li className="flex items-start gap-3 rounded-md border border-line/60 bg-surface-muted/30 p-2.5">
      <span className="mt-0.5 inline-flex shrink-0 items-center rounded bg-surface-muted px-1.5 py-0.5 text-[10px] font-semibold text-ink-muted">
        {tag}
      </span>
      <span className={`mt-1 size-2 shrink-0 rounded-full ${sourceColor}`} />
      <div className="min-w-0 flex-1">
        <p className="m-0 truncate text-[13px] font-medium text-ink">{title}</p>
        <p
          className={`m-0 mt-0.5 inline-block rounded px-1.5 py-0.5 text-[11px] ${metaClass}`}
        >
          {meta}
        </p>
      </div>
    </li>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// 3. Sources strip

function SourcesStrip() {
  // Use the same BrandLogo component the rest of the app uses (/connections
  // + per-row SourceIcon) so Slack renders via inline SVG (no PNG required)
  // and every icon stays consistent across marketing and product surfaces.
  const sources: Array<{ name: string; brand: 'gmail' | 'granola' | 'calendar' | 'linear' | 'slack' }> = [
    { name: 'Gmail', brand: 'gmail' },
    { name: 'Granola', brand: 'granola' },
    { name: 'Google Calendar', brand: 'calendar' },
    { name: 'Linear', brand: 'linear' },
    { name: 'Slack (coming soon)', brand: 'slack' },
  ]
  return (
    <section className="border-y border-line/60 bg-surface/40">
      <div className="mx-auto flex max-w-[1100px] flex-wrap items-center justify-between gap-4 px-6 py-6 text-ink-faint">
        <span className="text-[11px] font-semibold uppercase tracking-wider">
          Reads from
        </span>
        <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
          {sources.map(s => (
            <span key={s.name} className="inline-flex items-center gap-2 opacity-80">
              <BrandLogo brand={s.brand} size={18} />
              <span className="text-[13px] text-ink-muted">{s.name}</span>
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// 4. How it works

function HowItWorks() {
  return (
    <section id="how" className="mx-auto max-w-[1100px] px-6 py-20">
      <SectionHeader
        eyebrow="How it works"
        title="Three steps. One clean list."
        subtitle="Connect once. Open the app every morning. Dismiss what doesn't belong. The agent learns the pattern."
      />
      <div className="mt-12 grid gap-4 md:grid-cols-3">
        <StepCard
          n="01"
          icon={<Zap size={18} />}
          title="Connect once"
          body="One-click OAuth for Gmail, Calendar, Granola, Linear. Reads only what you authorize. No new credentials to manage, no extension to install."
        />
        <StepCard
          n="02"
          icon={<ListTodo size={18} />}
          title="Open your list every morning"
          body="taskbash pulled everything overnight. One ranked list of what you owe people today. Meeting briefs ready. Replies pre-drafted. Walk in caught up."
        />
        <StepCard
          n="03"
          icon={<Brain size={18} />}
          title="It learns your style"
          body="Dismiss anything that isn't yours. taskbash figures out the pattern: what kind of work you care about, what's someone else's job. No rules to set up. It adapts."
        />
      </div>
    </section>
  )
}

function StepCard({
  n,
  icon,
  title,
  body,
}: {
  n: string
  icon: React.ReactNode
  title: string
  body: string
}) {
  return (
    <Card className="border-line bg-surface transition-colors hover:border-line-strong">
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <span className="inline-flex size-9 items-center justify-center rounded-md bg-accent-soft text-ink">
            {icon}
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            {n}
          </span>
        </div>
        <h3 className="mt-4 m-0 text-[18px] font-semibold tracking-tight text-ink">
          {title}
        </h3>
        <p className="mt-2 m-0 text-[14px] leading-relaxed text-ink-muted">
          {body}
        </p>
      </CardContent>
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// 5. Feature grid

function FeatureGrid() {
  return (
    <section id="features" className="border-t border-line/60 bg-surface/30">
      <div className="mx-auto max-w-[1100px] px-6 py-20">
        <SectionHeader
          eyebrow="What it does"
          title="One list. Six ways it helps."
          subtitle="Built for operators who live in their inbox, their calendar, and their meeting notes all at once."
        />
        <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <FeatureCard
            icon={<Mail size={16} />}
            title="Pre-drafted replies"
            body="Every Gmail thread that needs a response shows up with a draft already written in your voice. Send, edit, or reject."
          />
          <FeatureCard
            icon={<CalIcon size={16} />}
            title="Meeting prep briefs"
            body="For every meeting in the next 36 hours: who's on it, recent thread history, talking points, the goal. Open the brief, walk into the call."
          />
          <FeatureCard
            icon={<ListTodo size={16} />}
            title="Cross-source dedup"
            body="Same commitment lands in three places. Granola, Gmail, Linear. taskbash collapses them into one row so you don't triage the same task twice."
          />
          <FeatureCard
            icon={<MessageSquare size={16} />}
            title="WhatsApp digest"
            body="Morning digest pushed to WhatsApp at your chosen local time. 10-minute pre-meeting reminders. Quiet hours respected."
          />
          <FeatureCard
            icon={<Sparkles size={16} />}
            title="Function tags"
            body="Define your own buckets (Product, Ops, Hiring, GTM). Every task auto-tagged. Filter and group your list by function in one click."
          />
          <FeatureCard
            icon={<Repeat size={16} />}
            title="Sharper every week"
            body="Every dismissal teaches taskbash what to skip. Two weeks in, the list is mostly things you want to do. A month in, it knows your priorities better than any todo app you've used."
          />
        </div>
      </div>
    </section>
  )
}

function FeatureCard({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode
  title: string
  body: string
}) {
  return (
    <Card className="border-line bg-surface transition-colors hover:border-line-strong">
      <CardContent className="p-6">
        <span className="inline-flex size-8 items-center justify-center rounded-md bg-accent-soft text-ink">
          {icon}
        </span>
        <h3 className="mt-4 m-0 text-[15px] font-semibold tracking-tight text-ink">
          {title}
        </h3>
        <p className="mt-1.5 m-0 text-[13.5px] leading-relaxed text-ink-muted">
          {body}
        </p>
      </CardContent>
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// 6. The slop loop (differentiator)

function SlopLoopSection() {
  return (
    <section id="learning" className="mx-auto max-w-[1100px] px-6 py-24">
      <div className="grid items-center gap-12 md:grid-cols-[0.9fr_1.1fr]">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider text-ink-muted">
            <Brain size={12} className="text-ink" />
            Adapts to you
          </span>
          <h2 className="mt-5 m-0 text-[36px] font-semibold leading-tight tracking-tight text-ink md:text-[40px]">
            Most apps make you fit them.
            <br />
            <span className="text-ink-muted">taskbash fits you.</span>
          </h2>
          <p className="mt-5 max-w-[460px] text-[15px] leading-relaxed text-ink-muted">
            Most task apps need rules, tags, and projects set up before they
            work. taskbash works on day one and gets sharper from there.
            Dismiss what isn't yours. Skip a category you don't care about.
            The agent picks up the pattern and stops surfacing similar items.
          </p>
          <p className="mt-3 max-w-[460px] text-[14px] leading-relaxed text-ink-faint">
            Two weeks in, your list is mostly things you want to do. A month
            in, taskbash knows your priorities better than any todo app
            you've used.
          </p>
        </div>

        <Card className="border-line bg-surface">
          <CardContent className="p-6 md:p-8">
            <LoopDiagram />
          </CardContent>
        </Card>
      </div>
    </section>
  )
}

function LoopDiagram() {
  const steps = [
    { n: '1', label: 'Reads', sub: 'Pulls fresh commitments from every connected tool overnight' },
    { n: '2', label: 'Surfaces', sub: 'One ranked list, ready when you open the app' },
    { n: '3', label: 'Notices', sub: 'Watches what you keep, dismiss, or correct' },
    { n: '4', label: 'Learns', sub: "Figures out what's yours and what isn't" },
    { n: '5', label: 'Adapts', sub: 'Next week the list is sharper. The week after, sharper still.' },
  ]
  return (
    <ol className="m-0 list-none space-y-3 p-0">
      {steps.map((s, i) => (
        <li key={s.n} className="flex items-start gap-3">
          <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-line-strong bg-surface-muted text-[12px] font-semibold text-ink">
            {s.n}
          </span>
          <div className="flex-1">
            <p className="m-0 text-[14px] font-medium text-ink">{s.label}</p>
            <p className="m-0 text-[12.5px] text-ink-muted">{s.sub}</p>
          </div>
          {i < steps.length - 1 && (
            <span className="mt-7 hidden text-ink-faint md:inline" aria-hidden>
              <ChevronRight size={14} />
            </span>
          )}
        </li>
      ))}
    </ol>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// 7. Stack

function StackSection() {
  const stack = [
    { name: 'Next.js', sub: 'App Router, RSC' },
    { name: 'Supabase', sub: 'Postgres + Auth + RLS' },
    { name: 'Inngest', sub: 'Crons + event functions' },
    { name: 'Anthropic', sub: 'Claude Opus + Haiku' },
    { name: 'Nango', sub: 'OAuth for every source' },
    { name: 'Langfuse', sub: 'LLM trace + eval scoring' },
    { name: 'Sentry', sub: 'Production error capture' },
    { name: 'Twilio', sub: 'WhatsApp delivery' },
  ]
  return (
    <section className="border-y border-line/60 bg-surface/30">
      <div className="mx-auto max-w-[1100px] px-6 py-16">
        <SectionHeader
          eyebrow="Under the hood"
          title="Built on the boring, reliable stack."
          subtitle="Every component picked because it works in production, not because it's trendy."
        />
        <div className="mt-10 grid gap-3 md:grid-cols-4">
          {stack.map(s => (
            <Card key={s.name} className="border-line bg-surface">
              <CardContent className="p-4">
                <p className="m-0 text-[13.5px] font-semibold text-ink">{s.name}</p>
                <p className="m-0 mt-0.5 text-[12px] text-ink-faint">{s.sub}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// 8. Final CTA

function FinalCTA() {
  return (
    <section className="mx-auto max-w-[1100px] px-6 py-24">
      <Card className="border-line bg-surface">
        <CardContent className="px-6 py-12 text-center md:px-10 md:py-16">
          <h2 className="m-0 text-[34px] font-semibold leading-tight tracking-tight text-ink md:text-[40px]">
            Stop tracking. Start finishing.
          </h2>
          <p className="mx-auto mt-3 max-w-[460px] text-[15px] leading-relaxed text-ink-muted">
            Connect Gmail and Calendar in 60 seconds. See your first list in
            under five minutes. Cancel anytime.
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/login"
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-6 py-3 text-[15px] font-medium text-primary-foreground hover:bg-accent-strong"
            >
              Sign in with Google
              <ArrowRight size={15} />
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center gap-2 rounded-lg border border-line bg-canvas px-6 py-3 text-[15px] font-medium text-ink hover:bg-surface-muted"
            >
              Sign in with Granola
            </Link>
          </div>
          <p className="mt-5 inline-flex items-center gap-1.5 text-[12px] text-ink-faint">
            <CheckCircle2 size={12} className="text-ink-faint" />
            Free while in beta. Your data is yours.
          </p>
        </CardContent>
      </Card>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// 9. Footer

function Footer() {
  return (
    <footer className="border-t border-line/60 bg-canvas">
      <div className="mx-auto flex max-w-[1100px] flex-wrap items-center justify-between gap-3 px-6 py-8 text-[12px] text-ink-faint">
        <div className="inline-flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-new.png" alt="taskbash" width={16} height={16} />
          <span className="font-medium text-ink-muted">taskbash</span>
          <span>· Never miss a task. Never track one either.</span>
        </div>
        <div className="flex items-center gap-4">
          <a href="/privacy" className="hover:text-ink">Privacy</a>
          <a href="/terms" className="hover:text-ink">Terms</a>
          <a href="mailto:subash@sigiq.ai" className="hover:text-ink">Contact</a>
        </div>
      </div>
    </footer>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Shared

function SectionHeader({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string
  title: string
  subtitle: string
}) {
  return (
    <div className="max-w-[640px]">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
        {eyebrow}
      </span>
      <h2 className="mt-2 m-0 text-[30px] font-semibold leading-tight tracking-tight text-ink md:text-[34px]">
        {title}
      </h2>
      <p className="mt-3 m-0 text-[15px] leading-relaxed text-ink-muted">
        {subtitle}
      </p>
    </div>
  )
}
