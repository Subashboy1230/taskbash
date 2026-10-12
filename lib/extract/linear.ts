// Linear extractor. Surface open issues the user actually needs to act on.
//
// History: v1 required a @-mention in a comment to avoid "every assigned
// ticket" noise. In practice that filter was too narrow for owners who
// FILE tickets themselves and work them without being pinged. Audit on
// 2026-10-12 showed 14 straight digest runs producing 0 Linear items
// while 20 open assigned issues sat in Todo / In PR Review.
//
// v2 keeps the mention path and adds three complementary signals that
// never need a comment to be actionable:
//   * priority 1 (Urgent) or 2 (High) assigned open issues
//   * assigned open issues with any dueDate
//   * assigned open issues in a review state (In PR Review, In Review,
//     Review, Ready for Review): someone is waiting on the user to
//     unblock a PR
// Dedupe by issue id. The judge is strict and will drop anything that
// turns out to be noise.
//
// Auth: Personal API key (NOT OAuth). Linear OAuth apps require workspace
// admin; Personal API keys don't — any user can mint one from their account
// settings. Trade-off: the key is tied to a single user (the one who minted
// it). In multi-tenant mode each user pastes their own.
//
// One-time setup:
//   1. linear.app → Settings → Security & access → Personal API keys → New.
//   2. Paste the lin_api_... key into /connections.
//
// Flow:
//   POST /graphql with Authorization: <api_key>
//   → viewer { id, name } + assignedIssues with recent comments
//   → keep issues where ANY comment body mentions the viewer
//   → map to ExtractedItem.

import { getActiveConnection } from '../connections'
import type { ExtractedItem } from '../types'

const LINEAR_GRAPHQL_URL = 'https://api.linear.app/graphql'

const MAX_ISSUES = 50
const MAX_COMMENTS_PER_ISSUE = 30
// Linear state.type values that count as "still actionable" for the digest.
const OPEN_STATE_TYPES = new Set(['backlog', 'unstarted', 'started', 'triage'])

// Workflow state names that represent the QA pipeline. Any issue in one of
// these states surfaces in the QA function bucket regardless of assignment.
const QA_STATE_NAMES = [
  'QA Requested',
  'Changes Requested',
  'In QA',
  'QA Passed',
  'QA passed',
]

// Workflow state names that mean "someone is waiting on the user to
// unblock a PR". Case-insensitive match. Issues assigned to the user in
// one of these states always surface, no comment-mention needed.
const REVIEW_STATE_NAMES = new Set(
  ['In PR Review', 'In Review', 'Review', 'Ready for Review', 'Code Review'].map(s =>
    s.toLowerCase()
  )
)

// ─── GraphQL types (only fields we use) ──────────────────────────────

interface LinearComment {
  id: string
  body?: string | null
  createdAt?: string
  user?: { id?: string; name?: string; displayName?: string; email?: string } | null
}

interface LinearIssue {
  id: string
  identifier: string // e.g. "ENG-123"
  title: string
  description?: string | null
  priority?: number | null // 0=none 1=urgent 2=high 3=medium 4=low
  dueDate?: string | null // ISO date (no time)
  url?: string
  state?: { name?: string; type?: string }
  team?: { key?: string; name?: string }
  assignee?: { id?: string; name?: string; email?: string } | null
  updatedAt?: string
  comments?: { nodes?: LinearComment[] }
}

interface AssignedIssuesResponse {
  data?: {
    viewer?: {
      id?: string
      name?: string
      displayName?: string
      email?: string
      assignedIssues?: { nodes?: LinearIssue[] }
    }
  }
  errors?: Array<{ message?: string }>
}

interface QAIssuesResponse {
  data?: {
    issues?: { nodes?: LinearIssue[] }
  }
  errors?: Array<{ message?: string }>
}

// ─── Public entry point ──────────────────────────────────────────────

interface ExtractArgs {
  userEmail: string
  userId?: string
  days?: number // unused for Linear — Linear's state is the "freshness" signal
}

export async function extractLinearActionItems(
  args: ExtractArgs // eslint-disable-line @typescript-eslint/no-unused-vars
): Promise<ExtractedItem[]> {
  const conn = await getActiveConnection('linear', args.userId)
  if (!conn || !conn.api_key) {
    throw new Error('Linear not connected — visit /connections to paste a Personal API key.')
  }

  const linearFetch = async <T>(query: string): Promise<T> => {
    const res = await fetch(LINEAR_GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: conn.api_key! },
      body: JSON.stringify({ query }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Linear API ${res.status}: ${body.slice(0, 200)}`)
    }
    return res.json() as Promise<T>
  }

  const assignedQuery = `
    query DigestIssues {
      viewer {
        id name displayName email
        assignedIssues(first: ${MAX_ISSUES}, orderBy: updatedAt) {
          nodes {
            id identifier title description priority dueDate url
            state { name type }
            team { key name }
            updatedAt
            comments(first: ${MAX_COMMENTS_PER_ISSUE}) {
              nodes { id body createdAt user { id name displayName email } }
            }
          }
        }
      }
    }
  `.trim()

  const qaStateList = QA_STATE_NAMES.map(s => `"${s}"`).join(', ')
  const qaQuery = `
    query QAIssues {
      issues(
        first: ${MAX_ISSUES}
        filter: { state: { name: { in: [${qaStateList}] } } }
        orderBy: updatedAt
      ) {
        nodes {
          id identifier title description priority dueDate url
          state { name type }
          team { key name }
          assignee { id name email }
          updatedAt
        }
      }
    }
  `.trim()

  // Run both queries in parallel.
  const [assignedResponse, qaResponse] = await Promise.all([
    linearFetch<AssignedIssuesResponse>(assignedQuery),
    linearFetch<QAIssuesResponse>(qaQuery).catch(err => {
      console.error('[linear] QA issues query failed:', err)
      return null
    }),
  ])

  if (assignedResponse.errors?.length) {
    const messages = assignedResponse.errors.map(e => e.message ?? 'unknown').join('; ')
    throw new Error(`Linear GraphQL errors: ${messages}`)
  }

  // ─── Assigned + mentioned issues (original logic) ────────────────────
  const viewer = assignedResponse.data?.viewer
  const viewerId = viewer?.id ?? null
  const viewerEmail = viewer?.email ?? args.userEmail
  const emailLocal = viewerEmail.split('@')[0] ?? ''
  const firstNameFromName = (viewer?.displayName || viewer?.name || '')
    .split(/\s+/)[0]
    .toLowerCase()
  const mentionTokens = Array.from(
    new Set([emailLocal.toLowerCase(), firstNameFromName].filter(t => t.length >= 2))
  )

  const assignedIssues = viewer?.assignedIssues?.nodes ?? []
  const openAssigned = assignedIssues.filter(
    i => i.state?.type && OPEN_STATE_TYPES.has(i.state.type)
  )

  // Signal 1: open assigned issues with a comment that mentions the user.
  // Classic "someone is asking me a question in the thread" signal.
  const mentioned = openAssigned.filter(issue => {
    const comments = issue.comments?.nodes ?? []
    if (comments.length === 0) return false
    return comments.some(c => {
      if (viewerId && c.body && c.body.includes(viewerId)) return true
      const body = (c.body || '').toLowerCase()
      return mentionTokens.some(token => body.includes(token))
    })
  })

  // Signal 2: priority Urgent (1) or High (2) assigned open issues. These
  // matter whether or not anyone has commented.
  const highPriority = openAssigned.filter(
    i => i.priority === 1 || i.priority === 2
  )

  // Signal 3: assigned open issues with a dueDate within the next 14 days.
  // Overdue items also qualify. Issues with no dueDate are ignored here;
  // they'll come through other paths if they matter.
  const soonMs = Date.now() + 14 * 24 * 60 * 60 * 1000
  const dueSoon = openAssigned.filter(i => {
    if (!i.dueDate) return false
    const t = new Date(`${i.dueDate}T23:59:00Z`).getTime()
    return Number.isFinite(t) && t <= soonMs
  })

  // Signal 4: assigned open issues in a review state (In PR Review etc).
  // Someone is waiting on the user to review or iterate.
  const inReview = openAssigned.filter(i => {
    const name = (i.state?.name ?? '').toLowerCase()
    return REVIEW_STATE_NAMES.has(name)
  })

  // Merge all signals, dedupe by issue id.
  const assignedBuckets = [mentioned, highPriority, dueSoon, inReview]
  const assignedById = new Map<string, LinearIssue>()
  for (const bucket of assignedBuckets) {
    for (const issue of bucket) {
      if (!assignedById.has(issue.id)) assignedById.set(issue.id, issue)
    }
  }
  const assignedSurfaced = Array.from(assignedById.values())

  // ─── QA pipeline issues ──────────────────────────────────────────────
  // Previously EVERY QA-state issue surfaced regardless of assignment, which
  // made the entire Linear digest engineering-QA noise (100% slop in the
  // 2026-06-10 analysis — ENGG/PRD tickets the CEO is not the QA owner of).
  // Now we only surface QA-state issues actually ASSIGNED to the viewer.
  // Being in a QA state on someone else's ticket is not the user's action.
  const qaIssues = qaResponse?.data?.issues?.nodes ?? []

  // Merge: dedupe by issue id so an issue surfaced by both the assigned
  // signals and the QA signal doesn't appear twice.
  const seenIds = new Set(assignedSurfaced.map(i => i.id))
  const qaAssignedToViewer = qaIssues.filter(
    i => !seenIds.has(i.id) && !!viewerId && i.assignee?.id === viewerId
  )

  return [
    ...assignedSurfaced.map(i => toExtractedItem(i, false)),
    ...qaAssignedToViewer.map(i => toExtractedItem(i, true)),
  ]
}

function toExtractedItem(issue: LinearIssue, isQA: boolean): ExtractedItem {
  const teamLabel = issue.team?.name
    ? `${issue.team.name} (${issue.team.key ?? ''})`
    : 'Linear'
  const parentContext = `${teamLabel}, ${issue.state?.name ?? 'open'}`

  // Title leads with the identifier so it's scannable in the digest
  // and so we don't lose track of an issue if Linear's title text changes.
  const title = `${issue.identifier} ${issue.title}`.trim()

  const dueAt = issue.dueDate
    ? new Date(`${issue.dueDate}T23:59:00Z`).toISOString()
    : null

  // Urgent: Linear priority 1 (Urgent) OR deadline within 24 hours.
  const isUrgentPriority = issue.priority === 1
  const isDueSoon = dueAt && new Date(dueAt).getTime() - Date.now() < 24 * 60 * 60 * 1000
  const urgent = isUrgentPriority || !!isDueSoon

  return {
    source: 'linear',
    source_ref: {
      linear_issue_id: issue.id,
      linear_issue_identifier: issue.identifier,
    },
    parent_context: parentContext,
    title,
    task_type: 'review',
    tag: 'action',
    urgent,
    due_at: dueAt,
  }
}
