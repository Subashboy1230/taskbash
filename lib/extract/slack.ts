// Slack source extractor — Composio-powered.
//
// Pulls recent Slack messages where the user is mentioned across their
// connected channels, drops the obvious noise (bot pings, channel
// joins, retroactive reactions), and surfaces the rest as ExtractedItem
// rows so they land on /today next to gmail/granola tasks.
//
// Why Composio (not direct Slack OAuth): the BuilderShip stack the
// project is integrating with this week. Composio handles the Slack
// OAuth dance and the per-tool input shape; we just call execute. The
// user authorizes Slack once at app.composio.dev (or via
// composioInitiateSlackConnection) and we persist the resulting
// connection id in env (COMPOSIO_SLACK_CONNECTION_ID).
//
// Gated by composioSlackConfigured(). If the env vars aren't set, this
// returns [] silently so the rest of the digest runs unchanged.

import { composioSlackConfigured, composioExecuteTool } from '../connectors/composio'
import type { ExtractedItem } from '../types'

interface SlackMessage {
  ts: string
  text: string
  user?: string
  channel?: string
  channel_name?: string
  permalink?: string
}

/**
 * Search recent messages where the user was mentioned in the last
 * `days` days. Returns a normalized message array, or [] if Composio
 * isn't configured for Slack.
 */
async function searchRecentMentions(args: {
  userHandle: string
  days: number
}): Promise<SlackMessage[]> {
  if (!composioSlackConfigured()) return []
  const connectionId = process.env.COMPOSIO_SLACK_CONNECTION_ID as string

  // Slack's search_messages tool query syntax: "@subash after:2026-06-03"
  const sinceDate = new Date(Date.now() - args.days * 24 * 60 * 60 * 1000)
  const sinceStr = sinceDate.toISOString().slice(0, 10) // YYYY-MM-DD
  const query = `@${args.userHandle} after:${sinceStr}`

  try {
    const res = await composioExecuteTool({
      tool: 'SLACK_SEARCH_MESSAGES',
      params: { query, count: 25, sort: 'timestamp', sort_dir: 'desc' },
      connectedAccountId: connectionId,
    })
    if (!res.successful || !res.data) return []
    const data = res.data as {
      messages?: { matches?: SlackMessage[] }
    }
    return (data.messages?.matches ?? []).slice(0, 25)
  } catch (err) {
    console.error('[extract/slack] search_messages failed:',
      err instanceof Error ? err.message : err)
    return []
  }
}

const NOISE_PATTERNS: RegExp[] = [
  /^<@U[A-Z0-9]+> has joined the channel$/i,
  /^set the channel/i,
  /^pinned a message/i,
  /^reacted with /i,
  /^<https?:\/\/[^>]+\|.*?> uploaded/i,
]

function isNoise(text: string): boolean {
  const t = (text || '').trim()
  if (t.length < 8) return true
  for (const p of NOISE_PATTERNS) if (p.test(t)) return true
  return false
}

function titleFrom(text: string): string {
  // First line, max 90 chars, with Slack markup softened.
  const first = (text.split('\n')[0] || '').trim()
  const stripped = first.replace(/<@U[A-Z0-9]+>/g, '@user').replace(/<#C[A-Z0-9]+\|([^>]+)>/g, '#$1')
  return stripped.length > 90 ? stripped.slice(0, 87) + '...' : stripped
}

export async function extractSlackActionItems(args: {
  userId: string
  userEmail: string
  userSlackHandle?: string
  days?: number
}): Promise<ExtractedItem[]> {
  if (!composioSlackConfigured()) return []
  const handle = args.userSlackHandle || process.env.COMPOSIO_SLACK_USER_HANDLE
  if (!handle) {
    console.warn('[extract/slack] COMPOSIO_SLACK_USER_HANDLE not set; skipping')
    return []
  }

  const days = args.days ?? 3
  const raw = await searchRecentMentions({ userHandle: handle, days })

  const items: ExtractedItem[] = []
  for (const m of raw) {
    if (isNoise(m.text)) continue
    const title = titleFrom(m.text)
    if (!title) continue
    items.push({
      source: 'slack',
      source_ref: {
        slack_ts: m.ts,
        slack_channel: m.channel ?? null,
        slack_permalink: m.permalink ?? null,
      },
      parent_context: m.channel_name ? `Slack #${m.channel_name}` : 'Slack',
      subtitle: m.text.slice(0, 240),
      title,
      task_type: 'reply',
      tag: 'reply',
      urgent: false,
      due_at: null,
    })
  }

  return items
}
