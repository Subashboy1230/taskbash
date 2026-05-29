// =========================================================
// Types matching the Supabase schema (migration 001).
// Update these in lockstep with migration files.
// =========================================================

export type TaskType =
  | 'research'
  | 'context_prep'
  | 'review'
  | 'follow_up'
  | 'post_call'
  | 'manual'

export type Tag = 'action' | 'reply' | 'commit' | 'fyi' | null

export type Status =
  | 'open'
  | 'in_progress'
  | 'snoozed'
  | 'completed'
  | 'dismissed'

export type Priority = 'P0' | 'P1' | 'P2' | 'P3' | null

export type Source = 'granola' | 'gmail' | 'slack' | 'calendar' | 'linear' | 'manual'

export interface SourceRef {
  granola_meeting_id?: string
  granola_meeting_date?: string
  gmail_thread_id?: string
  gmail_message_id?: string
  slack_channel_id?: string
  slack_ts?: string
  google_calendar_event_id?: string
  google_calendar_event_start?: string
  linear_issue_id?: string
  linear_issue_identifier?: string
}

// The synthesized brief attached to each task — the differentiator.
// See docs/brief-spec.md and lib/brief.ts.
export interface TaskBrief {
  why: string
  know: string[]
  done: string
  next: string
}

// An artifact the agent drafted that the user approves to execute.
// The agent fills this in when it can take an action on the user's behalf.
// Tagged-union by `kind` so the executor knows what to do on approval.
export type ProposedAction =
  | {
      kind: 'gmail_compose'
      to: string[]
      cc?: string[]
      subject: string
      body: string
      // Set when this is a reply (vs. a fresh thread). Used to populate
      // the Gmail compose URL with the right In-Reply-To headers, and to
      // surface a "Reply to existing thread" affordance in the UI.
      in_reply_to_message_id?: string
      thread_id?: string
    }
  | {
      kind: 'gmail_send'
      to: string[]
      cc?: string[]
      subject: string
      body: string
      in_reply_to_message_id?: string
      thread_id?: string
    }

export interface Item {
  id: string
  user_id: string
  title: string
  task_type: TaskType
  tag: Tag
  parent_context: string | null
  status: Status
  priority: Priority
  due_at: string | null
  snooze_until: string | null
  completed_at: string | null
  urgent: boolean
  source: Source
  source_ref: SourceRef
  parent_id: string | null
  semantic_hash: string
  first_seen_at: string
  last_seen_at: string
  age_days: number
  auto_completed_reason: string | null
  brief: TaskBrief | null
  brief_generated_at: string | null
  brief_status: 'pending' | 'generated' | 'failed'
  // The artifact the agent proposes; null when no action was drafted
  // (e.g. an FYI item, a meeting prep brief, an unanswered question).
  proposed_action: ProposedAction | null
  // Raw underlying content the agent drew on. Rendered in the Context Trail.
  source_excerpt: string | null
  created_at: string
  updated_at: string
}

// What an extractor returns. Plain JS, not yet a DB row.
export interface ExtractedItem {
  source: Source
  source_ref: SourceRef
  parent_context: string  // e.g. meeting title, email thread subject
  title: string           // the action item / task text
  tag?: Tag
  task_type: TaskType
  urgent?: boolean
  due_at?: string | null
  sub_items?: Array<Omit<ExtractedItem, 'sub_items'>>
  // Optional inline brief — used by extractors whose value IS the brief
  // (Calendar prep). Most extractors leave this null; briefs get generated
  // by scripts/backfill-briefs.ts after extraction.
  brief?: TaskBrief | null
  // Optional pre-drafted artifact for the user to approve. The Gmail
  // extractor sets this for "reply owed" items; other extractors leave null.
  proposed_action?: ProposedAction | null
  // Raw underlying content (email body, transcript chunk) for Context Trail.
  source_excerpt?: string | null
  // The id of the llm_calls row that produced this item. Set by
  // extractors after tracedMessage returns; the digest insert path uses
  // it to populate llm_calls.produced_item_ids[] so slop rate joins
  // work. Underscore prefix = transient (not a column on items).
  _llm_call_id?: string
}

export interface Run {
  id: string
  user_id: string
  started_at: string
  completed_at: string | null
  trigger: 'cron' | 'manual'
  sources_run: Source[]
  fresh_count: number
  new_count: number
  carryover_count: number
  completed_count: number
  status: 'running' | 'succeeded' | 'failed'
  error_message: string | null
}

export interface Connection {
  id: string
  user_id: string
  provider: string
  // OAuth providers (Gmail, Slack) use nango_connection_id. API-key providers
  // (Granola) leave this empty and use api_key instead.
  nango_connection_id: string | null
  api_key: string | null
  status: 'active' | 'expired' | 'error'
  scopes: string[] | null
  last_sync_at: string | null
  created_at: string
}

// What the user thinks of as a "source". Maps 1:1 to the connections.provider
// text column.
export type ConnectionProvider = 'gmail' | 'granola' | 'slack' | 'calendar' | 'linear'
