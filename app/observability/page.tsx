// /observability — admin dashboard for LLM call traces.
// Shows 24h activity (calls, tokens, cost, errors), per-prompt aggregates
// (calls, cost, avg latency, slop rate), and a live feed of recent calls.
//
// This is the "is the agent healthy?" page. Slop rate per prompt-version
// is the headline metric — it tells you whether your latest prompt
// rewrite is producing better extractions.

import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { loadObservability } from '@/lib/load-observability'
import { loadTodayEvents } from '@/lib/load-day-events'
import { getActiveConnection } from '@/lib/connections'
import { PageShell } from '@/app/_components/page-shell'
import { RecentCallsTable } from './recent-calls-table'

export const dynamic = 'force-dynamic'

export default async function ObservabilityPage() {
  const [data, events, calConn, supabase] = await Promise.all([
    loadObservability(),
    loadTodayEvents().catch(() => []),
    getActiveConnection('calendar').catch(() => null),
    createSupabaseServerClient(),
  ])
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return (
    <PageShell
      userEmail={user?.email ?? undefined}
      userInitial={(user?.email ?? 'U').charAt(0).toUpperCase()}
      events={events}
      calendarConnected={!!calConn?.nango_connection_id}
    >
      <div className="mx-auto max-w-[1100px]">
        <header className="mb-8">
          <Link
            href="/today"
            className="inline-flex items-center gap-1.5 text-[13px] text-ink-faint hover:text-ink"
          >
            <ChevronLeft size={14} />
            Back to today
          </Link>
          <h1 className="mt-2 mb-1 text-[28px] font-semibold tracking-tight text-ink">
            Observability
          </h1>
          <p className="m-0 text-[14px] text-ink-faint">
            Trace of every Claude call taskbash makes. Slop rate per prompt
            version is the headline metric. Keep it dropping.
          </p>
        </header>

        {/* ─── 24h top-of-funnel ───────────────────────────────────── */}
        <section className="mb-10">
          <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-wider text-ink-faint">
            Last 24 hours
          </h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Calls" value={data.calls_today.toLocaleString()} />
            <StatCard
              label="Cost"
              value={`$${data.cost_today.toFixed(4)}`}
              tone={data.cost_today > 1 ? 'warning' : 'default'}
            />
            <StatCard
              label="Tokens"
              value={
                data.tokens_today >= 1_000_000
                  ? `${(data.tokens_today / 1_000_000).toFixed(2)}M`
                  : data.tokens_today >= 1_000
                  ? `${(data.tokens_today / 1_000).toFixed(1)}k`
                  : data.tokens_today.toLocaleString()
              }
            />
            <StatCard
              label="Errors"
              value={data.errors_today.toString()}
              tone={data.errors_today > 0 ? 'danger' : 'default'}
            />
          </div>
        </section>

        {/* ─── Per-prompt aggregates ───────────────────────────────── */}
        <section className="mb-10">
          <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-wider text-ink-faint">
            Per prompt × version
          </h2>
          {data.per_prompt.length === 0 ? (
            <p className="m-0 rounded-md border border-dashed border-line bg-surface px-4 py-6 text-center text-[13px] text-ink-faint">
              No calls logged yet. Run the morning digest or approve a draft.
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-line bg-surface">
              <table className="w-full text-left text-[13px]">
                <thead className="border-b border-line bg-surface-muted/40 text-[11px] uppercase tracking-wider text-ink-faint">
                  <tr>
                    <th className="px-3 py-2 font-medium">Prompt</th>
                    <th className="px-3 py-2 font-medium">v</th>
                    <th className="px-3 py-2 text-right font-medium">Calls</th>
                    <th className="px-3 py-2 text-right font-medium">Cost</th>
                    <th className="px-3 py-2 text-right font-medium">Tokens</th>
                    <th className="px-3 py-2 text-right font-medium">Avg ms</th>
                    <th className="px-3 py-2 text-right font-medium">Errors</th>
                    <th className="px-3 py-2 text-right font-medium">Slop rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/70">
                  {data.per_prompt.map(p => (
                    <tr key={`${p.prompt_id}-${p.prompt_version}`}>
                      <td className="px-3 py-2 font-medium text-ink">{p.prompt_id}</td>
                      <td className="px-3 py-2 text-ink-muted tabular-nums">v{p.prompt_version}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink">{p.calls}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink-muted">
                        ${p.cost_usd.toFixed(4)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink-muted">
                        {((p.input_tokens + p.output_tokens) / 1000).toFixed(1)}k
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink-muted">
                        {p.avg_latency_ms}
                      </td>
                      <td className={cellTone('errors', p.errors)}>{p.errors}</td>
                      <td className={cellTone('slop', p.slop_rate)}>
                        {(p.slop_rate * 100).toFixed(1)}%
                        <span className="ml-1 text-ink-faint">
                          ({p.slop_count}/{p.calls})
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ─── Slop corpus ─────────────────────────────────────────── */}
        <section className="mb-10">
          <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-wider text-ink-faint">
            Training corpus
          </h2>
          <div className="rounded-lg border border-line bg-surface p-4">
            <div className="flex items-baseline justify-between">
              <div>
                <p className="m-0 text-[24px] font-semibold tabular-nums text-ink">
                  {data.slop_total}
                </p>
                <p className="m-0 text-[12px] text-ink-faint">
                  Slop signals captured ({data.slop_today} in last 24h)
                </p>
              </div>
              <p className="m-0 max-w-[400px] text-right text-[12px] text-ink-muted">
                Each row in <code className="text-[11px]">item_feedback</code> is a
                training example. Build an eval that replays the source
                content + your new prompt and verifies the new prompt
                would have correctly skipped it.
              </p>
            </div>
          </div>
        </section>

        {/* ─── Recent live feed ─────────────────────────────────────── */}
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="m-0 text-[12px] font-semibold uppercase tracking-wider text-ink-faint">
              Recent calls
            </h2>
            <p className="m-0 text-[11px] text-ink-faint">
              Save a good call → eval case. Run with{' '}
              <code className="text-[10px]">npm run eval</code>.
            </p>
          </div>
          <RecentCallsTable
            calls={data.recent_calls}
            datasetSuggestions={data.dataset_suggestions}
          />
        </section>
      </div>
    </PageShell>
  )
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'default' | 'warning' | 'danger'
}) {
  const valueColor =
    tone === 'danger'
      ? 'text-danger-fg'
      : tone === 'warning'
      ? 'text-tag-action-fg'
      : 'text-ink'
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3">
      <p className="m-0 text-[11px] uppercase tracking-wider text-ink-faint">{label}</p>
      <p className={`m-0 mt-1 text-[20px] font-semibold tabular-nums ${valueColor}`}>{value}</p>
    </div>
  )
}

function cellTone(kind: 'errors' | 'slop' | 'finish', value: unknown): string {
  const base = 'px-3 py-2 text-right tabular-nums'
  if (kind === 'errors') {
    return `${base} ${(value as number) > 0 ? 'text-danger-fg font-semibold' : 'text-ink-muted'}`
  }
  if (kind === 'slop') {
    const v = value as number
    return `${base} ${v > 0.2 ? 'text-danger-fg font-semibold' : v > 0.05 ? 'text-tag-action-fg' : 'text-ink-muted'}`
  }
  // finish
  const v = value as string | null
  return `${base.replace('text-right', '')} ${v === 'error' ? 'text-danger-fg' : v === 'end_turn' ? 'text-success-fg' : 'text-ink-muted'}`
}
