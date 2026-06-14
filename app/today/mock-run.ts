// Hardcoded, scripted "agent activity" sequence for the DEMO.
//
// The Agent Activity panel plays one of these on every Re-run (round-robin)
// instead of running the real digest. Pure UI theater: nothing here calls a
// backend. Each step shows its real tool logo and cycles through sub-states
// while it "works". Tune freely — it's all just for the demo.

export type MockStatus = 'done' | 'skipped' | 'failed'

export interface MockStep {
  id: string
  img?: string // logo path under /public (preferred)
  iconKey?: string // lucide fallback when there's no logo
  runningLabel: string
  doneLabel: string
  subStates?: string[] // cycled (dimmed) under the label while running
  status: MockStatus
  appearAt: number // ms after the panel opens
  resolveAt: number // ms after the panel opens
  detail?: { tool?: string; prompt_id?: string; note?: string }
}

export interface MockRun {
  steps: MockStep[]
  summaryLabel: string
  summaryAt: number
  closeAt: number
}

// The whole sequence is authored on a 60-second timeline, then normalized to
// TARGET_TOTAL_MS. Change this ONE number to make the demo longer/shorter.
const TARGET_TOTAL_MS = 60000

function scaleTo(run: MockRun, targetMs: number): MockRun {
  const f = run.closeAt > 0 ? targetMs / run.closeAt : 1
  const s = (n: number) => Math.round(n * f)
  return {
    ...run,
    steps: run.steps.map((st) => ({ ...st, appearAt: s(st.appearAt), resolveAt: s(st.resolveAt) })),
    summaryAt: s(run.summaryAt),
    closeAt: s(run.closeAt),
  }
}

interface VariantNumbers {
  granola: number
  threads: number
  events: number
  drafts: number
  newCount: number
}

// Fixed pipeline schedule (ms). Anthropic gets the longest window since it's
// the "heavy" step. Steps run one after another, each cycling sub-states.
function makeRun(v: VariantNumbers): MockRun {
  const steps: MockStep[] = [
    {
      id: 'inngest',
      img: '/logo-inngest.png',
      runningLabel: 'Firing Inngest',
      doneLabel: 'Inngest job started',
      subStates: ['Queuing the morning-digest job', 'Reserving a worker', 'Job accepted'],
      status: 'done',
      appearAt: 0,
      resolveAt: 4000,
      detail: { tool: 'Inngest', note: 'Durable background job runner' },
    },
    {
      id: 'composio',
      img: '/logo-composio.png',
      runningLabel: 'Connecting your sources via Composio',
      doneLabel: 'Connected to your sources',
      subStates: [
        'Authorizing Granola',
        'Authorizing Gmail and Calendar',
        'Authorizing Linear',
        'Authorizing Slack',
      ],
      status: 'done',
      appearAt: 4000,
      resolveAt: 11000,
      detail: { tool: 'Composio' },
    },
    {
      id: 'mem0',
      img: '/logo-mem0.png',
      runningLabel: 'Reading recent memory with mem0',
      doneLabel: 'Loaded your preferences from mem0',
      subStates: [
        'Loading your past slop corrections',
        'Building your preference profile',
        'Fine-tuning the extraction rules',
      ],
      status: 'done',
      appearAt: 11000,
      resolveAt: 18000,
      detail: { tool: 'mem0', note: 'Fine-tunes extraction from tasks you mark as slop' },
    },
    {
      id: 'anthropic',
      img: '/logo-anthropic.png',
      runningLabel: 'Running Anthropic Claude Opus 4.8',
      doneLabel: 'Extracted action items with Claude Opus 4.8',
      subStates: [
        `Reading ${v.granola} Granola meetings`,
        `Scanning ${v.threads} inbox threads`,
        `Reviewing ${v.events} calendar events`,
        'Extracting the action items you own',
      ],
      status: 'done',
      appearAt: 18000,
      resolveAt: 35000,
      detail: { tool: 'Anthropic Claude Opus 4.8', prompt_id: 'extract.*' },
    },
    {
      id: 'nebius',
      img: '/logo-nebius.png',
      runningLabel: 'Classifying with Nebius (Llama 3.3 70B)',
      doneLabel: 'Sorted into your work areas',
      subStates: ['Grouping by Product, Ops, GTM', 'Assigning function tags'],
      status: 'done',
      appearAt: 35000,
      resolveAt: 43000,
      detail: { tool: 'Nebius Llama 3.3 70B', prompt_id: 'classify.functions' },
    },
    {
      id: 'tavily',
      img: '/logo-tavily.png',
      runningLabel: 'Creating prep briefs via Tavily',
      doneLabel: 'Wrote your meeting prep briefs',
      subStates: ['Looking up attendees', 'Pulling company context', 'Writing why / what to know / next'],
      status: 'done',
      appearAt: 43000,
      resolveAt: 50000,
      detail: { tool: 'Tavily', prompt_id: 'prep.meeting' },
    },
    {
      id: 'gmail',
      img: '/logo-gmail.png',
      runningLabel: 'Creating Gmail drafts',
      doneLabel: `Drafted ${v.drafts} ${v.drafts === 1 ? 'reply' : 'replies'} in your voice`,
      subStates: ['Finding reply-owed threads', 'Drafting in your voice', 'Saving drafts to Gmail'],
      status: 'done',
      appearAt: 50000,
      resolveAt: 55000,
      detail: { tool: 'Gmail (via Nango)', prompt_id: 'draft.reply' },
    },
    {
      id: 'tasks',
      iconKey: 'tasks',
      runningLabel: 'Creating your tasks',
      doneLabel: `Added ${v.newCount} new ${v.newCount === 1 ? 'task' : 'tasks'}`,
      subStates: ['De-duping against existing tasks', 'Writing the new tasks', 'Ordering by priority'],
      status: 'done',
      appearAt: 55000,
      resolveAt: 58000,
      detail: { note: 'New tasks added, existing ones kept' },
    },
  ]
  return {
    steps,
    summaryLabel: `Added ${v.newCount} new ${v.newCount === 1 ? 'task' : 'tasks'}`,
    summaryAt: 58200,
    closeAt: 60000,
  }
}

// Round-robin variants — same pipeline, different numbers so repeated demos
// don't read as identical.
export const MOCK_VARIANTS: MockRun[] = [
  makeRun({ granola: 12, threads: 30, events: 8, drafts: 3, newCount: 4 }),
  makeRun({ granola: 9, threads: 24, events: 5, drafts: 5, newCount: 6 }),
  makeRun({ granola: 15, threads: 38, events: 11, drafts: 2, newCount: 3 }),
].map((r) => scaleTo(r, TARGET_TOTAL_MS))

const VARIANT_KEY = 'taskbash:demoVariant'

// Pick the next variant and advance the round-robin pointer (best-effort).
export function pickMockRun(): MockRun {
  let idx = 0
  try {
    idx = parseInt(localStorage.getItem(VARIANT_KEY) ?? '0', 10) || 0
    localStorage.setItem(VARIANT_KEY, String((idx + 1) % MOCK_VARIANTS.length))
  } catch {
    /* localStorage unavailable */
  }
  return MOCK_VARIANTS[idx % MOCK_VARIANTS.length]
}
