// Linear extractor — surface open issues assigned to the user.
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
// Flow: POST /graphql with Authorization: <api_key> → viewer.assignedIssues
// → filter to open states → map to ExtractedItem.

import { getActiveConnection } from '../connections'
import type { ExtractedItem } from '../types'

const LINEAR_GRAPHQL_URL = 'https://api.linear.app/graphql'

const MAX_ISSUES = 25
// Linear state.type values that count as "still actionable" for the digest.
const OPEN_STATE_TYPES = new Set(['backlog', 'unstarted', 'started', 'triage'])

// ─── GraphQL types (only fields we use) ──────────────────────────────

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
  updatedAt?: string
}

interface AssignedIssuesResponse {
  data?: {
    viewer?: {
      assignedIssues?: { nodes?: LinearIssue[] }
    }
  }
  errors?: Array<{ message?: string }>
}

// ─── Public entry point ──────────────────────────────────────────────

interface ExtractArgs {
  userEmail: string
  days?: number // unused for Linear — Linear's state is the "freshness" signal
}

export async function extractLinearActionItems(
  args: ExtractArgs // eslint-disable-line @typescript-eslint/no-unused-vars
): Promise<ExtractedItem[]> {
  const conn = await getActiveConnection('linear')
  if (!conn || !conn.api_key) {
    throw new Error('Linear not connected — visit /connections to paste a Personal API key.')
  }

  const query = `
    query DigestIssues {
      viewer {
        assignedIssues(first: ${MAX_ISSUES}, orderBy: updatedAt) {
          nodes {
            id
            identifier
            title
            description
            priority
            dueDate
            url
            state { name type }
            team { key name }
            updatedAt
          }
        }
      }
    }
  `.trim()

  // Linear's Authorization header takes the raw key (no "Bearer " prefix
  // for Personal API keys; that prefix is only for OAuth access tokens).
  const res = await fetch(LINEAR_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: conn.api_key,
    },
    body: JSON.stringify({ query }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Linear API ${res.status}: ${body.slice(0, 200)}`)
  }
  const response = (await res.json()) as AssignedIssuesResponse

  if (response.errors && response.errors.length > 0) {
    const messages = response.errors.map(e => e.message ?? 'unknown').join('; ')
    throw new Error(`Linear GraphQL errors: ${messages}`)
  }

  const issues = response.data?.viewer?.assignedIssues?.nodes ?? []
  const openIssues = issues.filter(
    i => i.state?.type && OPEN_STATE_TYPES.has(i.state.type)
  )

  return openIssues.map(toExtractedItem)
}

function toExtractedItem(issue: LinearIssue): ExtractedItem {
  const teamLabel = issue.team?.name
    ? `${issue.team.name} (${issue.team.key ?? ''})`
    : 'Linear'
  const parentContext = `${teamLabel} · ${issue.state?.name ?? 'open'}`

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
