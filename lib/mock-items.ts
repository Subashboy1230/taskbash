// Mock data — Day 3.5
// All three sources represented (Granola, Gmail, Slack), varied tags, varied
// deadline states (overdue, today, tomorrow, this week, none).

import type { Priority, ProposedAction, Source, Tag, TaskType, TaskBrief } from './types'

export interface MockSubItem {
  id: string
  title: string
  completed?: boolean
}

export interface MockTranscriptBullet {
  text: string
}

export interface MockItem {
  id: string
  title: string
  task_type: TaskType
  tag: Tag
  parent_context: string | null
  status: 'open' | 'in_progress' | 'completed'
  source: Source
  priority?: Priority
  urgent: boolean
  // User-defined function tags ("Product", "Hiring", etc.). Many-to-many
  // — a task can belong to multiple functions.
  function_ids?: string[]
  age_days: number
  due_at?: string | null            // ISO timestamp; formatDeadline() turns it into a label
  is_new_today?: boolean
  status_label?: string
  status_label_tone?: 'success' | 'warning' | 'danger' | 'info'
  count_label?: string

  detail_status?: string
  description?: string
  transcript_pull?: MockTranscriptBullet[]
  link?: { label: string; url: string }
  completed_at?: string

  // The synthesized brief — the differentiator. Null until generated.
  brief?: TaskBrief | null

  // Pre-drafted artifact (Nummo-style approval queue). When present, the
  // detail panel shows the draft inline + an Approve/Send action.
  proposed_action?: ProposedAction | null

  // Raw underlying source content (the email body, the meeting transcript
  // excerpt) for the Context Trail tab.
  source_excerpt?: string | null

  sub_items?: MockSubItem[]
}

export interface MockDigestSummary {
  user_name: string
  user_initials: string
  greeting: string
  date_iso: string
  active_tasks_label: string
  active_count: number
  completed_today_count: number
  counts: {
    new: number
    carryover: number
    cleared_overnight: number
    overdue: number
  }
  open_items: MockItem[]
  completed_today: MockItem[]
}

// Anchor "now" so deadlines look stable across sessions.
// Adjust here if you want different deadline states in the demo.
const TODAY = new Date()                 // real "now" — deadlines update over time
const TOMORROW_9AM = isoOffsetHours(24)  // ~24h from now
const TODAY_5PM = isoOffsetHours(5)      // ~5h from now (user's clock dependent)
const FRIDAY = isoOffsetDays(2)          // a couple days out
const OVERDUE_15H = isoOffsetHours(-15)  // 15h ago

function isoOffsetHours(hours: number): string {
  return new Date(TODAY.getTime() + hours * 60 * 60 * 1000).toISOString()
}
function isoOffsetDays(days: number): string {
  return new Date(TODAY.getTime() + days * 24 * 60 * 60 * 1000).toISOString()
}

export function getMockDigest(): MockDigestSummary {
  return {
    user_name: 'Subash',
    user_initials: 'SR',
    greeting: 'Good afternoon, Subash',
    date_iso: TODAY.toISOString().split('T')[0],
    active_tasks_label: "A few left. Let's clear them.",
    active_count: 4,
    completed_today_count: 6,
    counts: {
      new: 2,
      carryover: 2,
      cleared_overnight: 4,
      overdue: 1,
    },
    open_items: [
      // ─── Granola: post-call commitment with subtasks + tomorrow deadline ───
      {
        id: 'mock-1',
        title: 'Send Matthew the 3 pain points doc',
        task_type: 'post_call',
        tag: 'reply',
        parent_context: 'May 12 call with Matthew Lee (Nummo)',
        status: 'open',
        source: 'granola',
        urgent: false,
        age_days: 1,
        due_at: TOMORROW_9AM,
        is_new_today: true,
        count_label: '1 brief',
        status_label: 'I drafted the message',
        status_label_tone: 'info',
        detail_status: 'In progress',
        description:
          'You committed on May 12 to send Matthew the three specific pain points he could take back to his Nummo team. He framed "two days" — anchored to a Tuesday delivery.',
        transcript_pull: [
          { text: 'Pain point 1 — token re-auth: shared OAuth tokens across MCP connectors instead of per-user re-auth every time.' },
          { text: 'Pain point 2 — context refresh: agents that re-pull source data on demand, not just at scheduled cron times.' },
          { text: 'Pain point 3 — between-the-lines synthesis: surfacing what the data MEANS for this meeting, not just what it says.' },
        ],
        sub_items: [
          { id: 'mock-1-a', title: 'Token re-auth — write the example' },
          { id: 'mock-1-b', title: 'Context refresh — pick the Pilot example' },
          { id: 'mock-1-c', title: 'Synthesis — write 3-sentence framing' },
        ],
      },

      // ─── Gmail: review with subtasks + overdue ─────────────────────────
      {
        id: 'mock-2',
        title: 'Review bookkeeping questions and draft reports',
        task_type: 'review',
        tag: 'action',
        parent_context: 'pilot@pilot.com',
        status: 'open',
        source: 'gmail',
        urgent: true,
        age_days: 12,
        due_at: OVERDUE_15H,
        count_label: '1 brief',
        status_label: 'Needs your review',
        status_label_tone: 'danger',
        detail_status: 'Needs your review',
        description:
          'Pilot sent 4 open questions on May 1; you haven\'t replied. Two of four are uncategorized Stripe charges. CSC receipt for $255.50 arrived May 11 — fixes question 2. Rho still wants the $25 CA SOS receipt; stalled since May 11.',
        link: { label: 'Open Pilot questions', url: '#' },
        sub_items: [
          { id: 'mock-2-a', title: 'Match the $255.50 CSC receipt to Q2 expenses' },
          { id: 'mock-2-b', title: 'Find the $25 CA Secretary of State receipt' },
          { id: 'mock-2-c', title: 'Ping Lina in Slack to chase the receipt' },
        ],
      },

      // ─── Slack: today deadline, urgent ─────────────────────────────────
      {
        id: 'mock-3',
        title: 'Confirm Q3 OKRs draft with Anna',
        task_type: 'follow_up',
        tag: 'commit',
        parent_context: 'Slack DM with Anna Park',
        status: 'open',
        source: 'slack',
        urgent: true,
        age_days: 4,
        due_at: TODAY_5PM,
        count_label: '1 to-do',
        status_label: 'Anna is waiting',
        status_label_tone: 'warning',
        detail_status: 'Needs your review',
        description:
          'Anna sent the Q3 OKRs draft on May 9 and asked for your sign-off before the leadership sync Friday. She\'s pinged twice since.',
        link: { label: 'Open Slack thread', url: '#' },
      },

      // ─── Slack: FYI, no deadline, no subtasks ──────────────────────────
      {
        id: 'mock-4',
        title: "Karim's EdTech post — decide if you weigh in",
        task_type: 'review',
        tag: 'fyi',
        parent_context: '#content channel',
        status: 'open',
        source: 'slack',
        urgent: false,
        age_days: 2,
        is_new_today: false,
        count_label: '1 to-do',
        status_label: 'Just an FYI',
        status_label_tone: 'info',
        detail_status: 'Review needed',
        description:
          'Karim posted a contrarian take on K-12 AI policy this morning. ~50 likes, mostly from school operators. You\'re not tagged but he\'s asked before what you think on similar posts.',
      },
    ],
    completed_today: [
      {
        id: 'mock-c1',
        title: 'Post-Call Brief: Mo <> Matt (Nummo)',
        task_type: 'post_call',
        tag: 'commit',
        parent_context: 'May 12 call with Matthew Lee',
        status: 'completed',
        source: 'granola',
        urgent: false,
        age_days: 0,
        count_label: '1 brief',
        status_label: 'Approved',
        status_label_tone: 'success',
        completed_at: TODAY.toISOString(),
      },
      {
        id: 'mock-c2',
        title: 'Reply to Mary Vue on AE candidate Sara Chen',
        task_type: 'review',
        tag: 'reply',
        parent_context: 'mary@vue.co',
        status: 'completed',
        source: 'gmail',
        urgent: false,
        age_days: 0,
        count_label: '1 brief',
        status_label: 'Approved',
        status_label_tone: 'success',
        completed_at: TODAY.toISOString(),
      },
      {
        id: 'mock-c3',
        title: 'Confirmed Tuesday all-hands agenda',
        task_type: 'follow_up',
        tag: 'commit',
        parent_context: 'Slack DM with Founder',
        status: 'completed',
        source: 'slack',
        urgent: false,
        age_days: 0,
        count_label: '1 to-do',
        status_label: 'Approved',
        status_label_tone: 'success',
        completed_at: TODAY.toISOString(),
      },
    ],
  }
}
