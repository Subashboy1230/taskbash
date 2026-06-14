'use client'

// Workflows: agent on/off catalog (mock).
//
// Two kinds of workflows:
//   1. Background. taskbash runs them itself on the server
//   2. Browser. Needs a real browser context (LinkedIn / web QA), so
//                    we hand the user a Claude Cowork prompt to paste in
//
// One workflow is real today: Gmail Draft Replies. The rest are stubs
// labeled "Coming soon". Toggles are disabled on stubs so a demo click
// can't trigger anything that doesn't exist.

import { useState } from 'react'
import {
  Mail,
  Inbox,
  Reply,
  Calendar,
  ClipboardCheck,
  FileText,
  Bug,
  Linkedin,
  Copy,
  Check,
  Sparkles,
  Lock,
} from 'lucide-react'
import { Card, CardContent } from '@/app/_components/ui/card'
import { cn } from '@/lib/utils'

// ─── Workflow data ────────────────────────────────────────────────────

type WorkflowKind = 'background' | 'browser'

interface Workflow {
  id: string
  title: string
  description: string
  kind: WorkflowKind
  icon: typeof Mail
  // Brand tint for the icon halo. Pick from the existing tag palette
  // so colors stay consistent with /today.
  tone: 'blue' | 'green' | 'orange' | 'purple' | 'pink' | 'gray'
  // The only enabled workflow today is Gmail drafts. Everything else
  // renders as Coming soon. Setting enabled=true on more cards is the
  // single line to flip when a workflow ships for real.
  enabled: boolean
  // Browser workflows ship with a Claude Cowork prompt the user copies
  // into the desktop app to actually run the agent.
  coworkPrompt?: string
}

const WORKFLOWS: Workflow[] = [
  {
    id: 'gmail-drafts',
    title: 'Gmail Draft Replies',
    description:
      'Every thread that needs a response shows up on /today with a draft already written in your voice. Send, edit, or reject.',
    kind: 'background',
    icon: Mail,
    tone: 'green',
    enabled: true,
  },
  {
    id: 'email-triage',
    title: 'Email Triage',
    description:
      'Auto-categorize every incoming thread: needs reply, FYI, scheduling, noise. Quiet the inbox before you open it.',
    kind: 'background',
    icon: Inbox,
    tone: 'blue',
    enabled: false,
  },
  {
    id: 'email-followups',
    title: 'Email Follow-ups',
    description:
      'When a thread you started goes quiet for N days, draft a polite follow-up and queue it for approval.',
    kind: 'background',
    icon: Reply,
    tone: 'orange',
    enabled: false,
  },
  {
    id: 'meeting-setter',
    title: 'Meeting Setter',
    description:
      'Reads scheduling threads, finds 3 times on your calendar, proposes them. Auto-confirm with trusted contacts.',
    kind: 'background',
    icon: Calendar,
    tone: 'purple',
    enabled: false,
  },
  {
    id: 'candidate-shortlist',
    title: 'Candidate Shortlisting',
    description:
      'Score every resume against your live JD. Surfaces the top 5, drafts the outreach, flags the maybes.',
    kind: 'background',
    icon: ClipboardCheck,
    tone: 'pink',
    enabled: false,
  },
  {
    id: 'prd-writer',
    title: 'PRD Writer',
    description:
      'Turns Granola notes plus a Loom into a first-draft PRD with goals, scope, open questions, and a rollout plan.',
    kind: 'background',
    icon: FileText,
    tone: 'blue',
    enabled: false,
  },
  {
    id: 'linkedin-connector',
    title: 'LinkedIn Connector',
    description:
      'Personalized connection requests + first-message follow-ups based on the prospect\'s recent posts.',
    kind: 'browser',
    icon: Linkedin,
    tone: 'blue',
    enabled: false,
    coworkPrompt:
      'You are running a LinkedIn outreach session for me. Use Claude in Chrome to: (1) open each profile I paste in, (2) read their three most recent posts, (3) draft a 2-sentence connection-request note that references one specific thing they posted, (4) wait for my approval before sending. Never send without explicit confirmation.',
  },
  {
    id: 'qa-agent',
    title: 'Automatic QA',
    description:
      'Walks a checklist of user flows on a staging URL, captures screenshots, files a triage doc with what broke.',
    kind: 'browser',
    icon: Bug,
    tone: 'orange',
    enabled: false,
    coworkPrompt:
      'You are running a QA pass for me. Use Claude in Chrome to: (1) load the staging URL I paste in, (2) walk through this checklist of flows: sign-in, dashboard load, create-item, send-message, sign-out. For each, take a screenshot and note any console errors or visible bugs. (3) Compile a triage doc grouped by severity (blocker / major / minor / cosmetic).',
  },
]

const TONE_CLASSES: Record<Workflow['tone'], { halo: string; icon: string }> = {
  blue:   { halo: 'bg-blue-500/10 ring-1 ring-blue-500/25',      icon: 'text-blue-400' },
  green:  { halo: 'bg-emerald-500/10 ring-1 ring-emerald-500/25', icon: 'text-emerald-400' },
  orange: { halo: 'bg-orange-500/10 ring-1 ring-orange-500/25',   icon: 'text-orange-300' },
  purple: { halo: 'bg-violet-500/10 ring-1 ring-violet-500/25',   icon: 'text-violet-300' },
  pink:   { halo: 'bg-pink-500/10 ring-1 ring-pink-500/25',       icon: 'text-pink-300' },
  gray:   { halo: 'bg-ink-faint/10 ring-1 ring-line',             icon: 'text-ink-muted' },
}

// ─── View ─────────────────────────────────────────────────────────────

export function WorkflowsView() {
  const enabled = WORKFLOWS.filter(w => w.enabled)
  const queued = WORKFLOWS.filter(w => !w.enabled)

  return (
    <div className="mx-auto max-w-[960px]">
      <header className="mb-8">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider text-ink-muted">
          <Sparkles size={12} className="text-ink" />
          Agent catalog
        </div>
        <h1 className="mt-3 mb-1 text-[28px] font-semibold tracking-tight text-ink">
          Workflows
        </h1>
        <p className="m-0 max-w-[640px] text-[14px] leading-relaxed text-ink-muted">
          Let agents do the work for you. Background workflows run on
          taskbash. Browser workflows hand you a Claude prompt you paste
          into Cowork. One is live today; the rest are queued.
        </p>
      </header>

      {/* Enabled */}
      <section className="mb-10">
        <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-wider text-ink-faint">
          Enabled · {enabled.length}
        </h2>
        <div className="grid gap-3">
          {enabled.map(w => (
            <WorkflowCard key={w.id} workflow={w} />
          ))}
        </div>
      </section>

      {/* Coming soon */}
      <section>
        <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-wider text-ink-faint">
          Coming soon · {queued.length}
        </h2>
        <div className="grid gap-3 md:grid-cols-2">
          {queued.map(w => (
            <WorkflowCard key={w.id} workflow={w} />
          ))}
        </div>
      </section>
    </div>
  )
}

// ─── Card ─────────────────────────────────────────────────────────────

function WorkflowCard({ workflow }: { workflow: Workflow }) {
  const tone = TONE_CLASSES[workflow.tone]
  const Icon = workflow.icon
  const [copied, setCopied] = useState(false)

  const copyPrompt = async () => {
    if (!workflow.coworkPrompt) return
    try {
      await navigator.clipboard.writeText(workflow.coworkPrompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // Older browsers might not support clipboard API; mock UI, ignore.
    }
  }

  return (
    <Card
      className={cn(
        'border-line bg-surface transition-colors',
        workflow.enabled ? 'hover:border-line-strong' : 'opacity-90',
      )}
    >
      <CardContent className="p-5">
        <div className="flex items-start gap-4">
          {/* Icon halo */}
          <div className={cn('inline-flex size-10 shrink-0 items-center justify-center rounded-lg', tone.halo)}>
            <Icon size={18} className={tone.icon} />
          </div>

          {/* Body */}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 className="m-0 text-[15px] font-semibold tracking-tight text-ink">
                {workflow.title}
              </h3>
              <KindChip kind={workflow.kind} />
              {workflow.enabled ? <StatusChip variant="on" /> : <StatusChip variant="soon" />}
            </div>
            <p className="mt-1.5 m-0 text-[13.5px] leading-relaxed text-ink-muted">
              {workflow.description}
            </p>

            {/* Action row */}
            <div className="mt-4 flex items-center justify-between gap-3">
              {workflow.enabled ? (
                <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-faint">
                  <Lock size={11} /> Toggle managed in /today drafts approval queue
                </span>
              ) : workflow.kind === 'browser' ? (
                <button
                  onClick={copyPrompt}
                  className="inline-flex items-center gap-1.5 rounded-md border border-line bg-canvas px-2.5 py-1.5 text-[12px] font-medium text-ink-muted hover:text-ink hover:border-line-strong"
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  {copied ? 'Prompt copied' : 'Copy Cowork prompt'}
                </button>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-faint">
                  <Lock size={11} /> Queued for build
                </span>
              )}

              <Toggle on={workflow.enabled} disabled={!workflow.enabled} />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Small UI pieces ─────────────────────────────────────────────────

function KindChip({ kind }: { kind: WorkflowKind }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
        kind === 'background' ? 'bg-accent-soft text-ink-muted' : 'bg-blue-500/10 text-blue-300',
      )}
    >
      {kind === 'background' ? 'Background' : 'Browser agent'}
    </span>
  )
}

function StatusChip({ variant }: { variant: 'on' | 'soon' }) {
  if (variant === 'on') {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
        <span className="size-1.5 rounded-full bg-emerald-400" /> Enabled
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded bg-surface-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
      Coming soon
    </span>
  )
}

// A pure visual toggle. The "on" workflow shows it locked in the on
// position; the rest show it locked off. No click handler (this page
// is mock-only and the real Gmail draft on/off lives elsewhere).
function Toggle({ on, disabled }: { on: boolean; disabled?: boolean }) {
  return (
    <span
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
        on ? 'bg-emerald-500/60' : 'bg-surface-muted',
        disabled && 'opacity-60',
      )}
      aria-hidden
    >
      <span
        className={cn(
          'inline-block size-3.5 rounded-full bg-ink shadow-sm transition-transform',
          on ? 'translate-x-[18px]' : 'translate-x-[2px]',
        )}
      />
    </span>
  )
}
