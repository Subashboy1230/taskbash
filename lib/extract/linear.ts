// Linear extractor — surface open issues assigned to the user.
//
// Linear uses GraphQL; one POST to /graphql returns every assigned issue.
// We filter to "open" states (backlog / unstarted / started / triage) and
// turn each into an action-tagged review task.
//
// Scope: up to MAX_ISSUES most-recently-updated assigned + open issues.
// Closed (completed/cancelled) issues are skipped — they auto-clear from
// the digest via the diff logic the next morning anyway.
//
// One-time setup:
//   1. https://linear.app/settings/api/applications → New OAuth application
//      - Redirect URI: https://api.nango.dev/oauth/callback
//      - Scope: read (or "Read" toggle on)
//   2. Note the Client ID and Client Secret.
//   3. Create a "Linear" integration in Nango with those credentials,
//      scope: read.
//   4. User connects via /connections.

import { nangoProxy } from '../nango'
import { getActiveConnection, NANGO_PROVIDER_KEY } from '../connections'
import type { ExtractedItem } from '../types'

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
  if (!conn || !conn.nango_connection_id) {
    throw new Error('Linear not connected — visit /connections to set it up.')
  }
  const providerConfigKey = NANGO_PROVIDER_KEY.linear!
  const connectionId = conn.nango_connection_id

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

  const response = await nangoProxy<AssignedIssuesResponse>({
    providerConfigKey,
    connectionId,
    method: 'POST',
    endpoint: '/graphql',
    data: { query },
  })

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
