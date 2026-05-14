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

export type Source = 'granola' | 'gmail' | 'slack' | 'manual'

export interface SourceRef {
  granola_meeting_id?: string
  granola_meeting_date?: string
  gmail_thread_id?: string
  gmail_message_id?: string
  slack_channel_id?: string
  slack_ts?: string
}

// The synthesized brief attached to each task — the differentiator.
// See docs/brief-spec.md and lib/brief.ts.
export interface TaskBrief {
  why: string
  know: string[]
  done: string
  next: string
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
  nango_connection_id: string
  status: 'active' | 'expired' | 'error'
  scopes: string[] | null
  last_sync_at: string | null
  created_at: string
}
