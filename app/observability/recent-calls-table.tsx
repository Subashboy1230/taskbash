'use client'

// Recent calls feed + inline Promote-to-dataset modal.
// Split out from page.tsx because we need client interactivity for the
// modal; the rest of /observability stays as a server component for
// fast SSR.

import { useState, useTransition } from 'react'
import { Bookmark, Check, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  promoteCallToDataset,
  type ExpectedBehavior,
} from './actions'

export interface RecentCall {
  id: string
  prompt_id: string
  prompt_version: number
  request_model: string
  finish_reason: string | null
  input_tokens: number | null
  output_tokens: number | null
  cost_usd: number | null
  latency_ms: number | null
  started_at: string
  error: string | null
  response_text: string | null
}

export function RecentCallsTable({
  calls,
  datasetSuggestions,
}: {
  calls: RecentCall[]
  datasetSuggestions: Array<{ id: string; name: string; prompt_id: string }>
}) {
  const [promoting, setPromoting] = useState<RecentCall | null>(null)
  if (calls.length === 0) {
    return <p className="m-0 text-[13px] text-ink-faint">No recent calls.</p>
  }
  return (
    <>
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <table className="w-full text-left text-[13px]">
          <thead className="border-b border-line bg-surface-muted/40 text-[11px] uppercase tracking-wider text-ink-faint">
            <tr>
              <th className="px-3 py-2 font-medium">Time</th>
              <th className="px-3 py-2 font-medium">Prompt</th>
              <th className="px-3 py-2 font-medium">Model</th>
              <th className="px-3 py-2 text-right font-medium">Tokens</th>
              <th className="px-3 py-2 text-right font-medium">Cost</th>
              <th className="px-3 py-2 text-right font-medium">ms</th>
              <th className="px-3 py-2 font-medium">Finish</th>
              <th className="px-3 py-2 text-right font-medium">Promote</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/70">
            {calls.map(c => (
              <tr key={c.id}>
                <td className="px-3 py-2 text-ink-muted" suppressHydrationWarning>
                  {new Date(c.started_at).toLocaleTimeString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </td>
                <td className="px-3 py-2 text-ink">
                  {c.prompt_id}
                  <span className="ml-1 text-[11px] text-ink-faint">
                    v{c.prompt_version}
                  </span>
                </td>
                <td className="px-3 py-2 text-[11px] text-ink-faint">
                  {c.request_model.replace('claude-', '').replace(/-\d{8}$/, '')}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-ink-muted">
                  {(c.input_tokens ?? 0) + (c.output_tokens ?? 0)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-ink-muted">
                  ${(c.cost_usd ?? 0).toFixed(4)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-ink-muted">
                  {c.latency_ms ?? '-'}
                </td>
                <td
                  className={cn(
                    'px-3 py-2',
                    c.error
                      ? 'text-danger-fg'
                      : c.finish_reason === 'end_turn'
                      ? 'text-success-fg'
                      : 'text-ink-muted'
                  )}
                >
                  {c.error ? 'error' : c.finish_reason ?? '-'}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => setPromoting(c)}
                    className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-0.5 text-[11px] font-medium text-ink-muted hover:border-line-strong hover:text-ink"
                    title="Save as eval case"
                  >
                    <Bookmark size={11} />
                    Save
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {promoting && (
        <PromoteModal
          call={promoting}
          datasetSuggestions={datasetSuggestions}
          onClose={() => setPromoting(null)}
        />
      )}
    </>
  )
}

function PromoteModal({
  call,
  datasetSuggestions,
  onClose,
}: {
  call: RecentCall
  datasetSuggestions: Array<{ id: string; name: string; prompt_id: string }>
  onClose: () => void
}) {
  // Suggest datasets pinned to this prompt_id first; the user can also
  // type a new name to create one.
  const matchingDatasets = datasetSuggestions.filter(
    d => d.prompt_id === call.prompt_id
  )
  const [datasetName, setDatasetName] = useState(
    matchingDatasets[0]?.name ?? `gold-${call.prompt_id}`
  )
  const [expectedOutput, setExpectedOutput] = useState(call.response_text ?? '')
  const [behavior, setBehavior] = useState<ExpectedBehavior>('exact')
  const [notes, setNotes] = useState('')
  const [busy, startSave] = useTransition()
  const [result, setResult] = useState<
    | { ok: true; createdDataset: boolean }
    | { ok: false; error: string }
    | null
  >(null)

  function onClose_(_?: React.MouseEvent) {
    onClose()
  }

  function handleSave() {
    startSave(async () => {
      const r = await promoteCallToDataset({
        callId: call.id,
        datasetName: datasetName.trim(),
        expectedOutput,
        expectedBehavior: behavior,
        notes: notes || undefined,
      })
      setResult(r)
      if (r.ok) {
        // Auto-close after 1s on success.
        setTimeout(() => onClose_(), 1200)
      }
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
      onClick={onClose_}
    >
      <div
        className="w-full max-w-[640px] rounded-lg border border-line bg-surface p-5 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="m-0 text-[15px] font-semibold text-ink">Promote to eval dataset</h2>
            <p className="m-0 mt-0.5 text-[12px] text-ink-faint">
              {call.prompt_id} v{call.prompt_version} · {call.request_model}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose_}
            className="rounded-md p-1 text-ink-faint hover:bg-surface-muted hover:text-ink"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="m-0 mb-1 block text-[12px] font-medium text-ink-muted">
              Dataset name
            </label>
            <input
              type="text"
              value={datasetName}
              onChange={e => setDatasetName(e.target.value)}
              placeholder={`gold-${call.prompt_id}`}
              className="w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink focus:border-success-fg focus:outline-none"
            />
            {matchingDatasets.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                <span className="text-[11px] text-ink-faint">Existing:</span>
                {matchingDatasets.map(d => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setDatasetName(d.name)}
                    className="rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-muted hover:border-line-strong hover:text-ink"
                  >
                    {d.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="m-0 mb-1 block text-[12px] font-medium text-ink-muted">
              Expected behavior
            </label>
            <select
              value={behavior}
              onChange={e => setBehavior(e.target.value as ExpectedBehavior)}
              className="w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink focus:border-success-fg focus:outline-none"
            >
              <option value="exact">Exact match: output equals expected (after trim)</option>
              <option value="contains">Contains: expected appears as substring</option>
              <option value="empty">Empty: prompt should skip this input</option>
              <option value="manual_review">Manual: score by hand later</option>
            </select>
          </div>

          {behavior !== 'empty' && (
            <div>
              <label className="m-0 mb-1 block text-[12px] font-medium text-ink-muted">
                Expected output (defaults to what we got)
              </label>
              <textarea
                value={expectedOutput}
                onChange={e => setExpectedOutput(e.target.value)}
                rows={Math.min(10, Math.max(4, expectedOutput.split('\n').length))}
                className="w-full resize-y rounded-md border border-line bg-surface px-2.5 py-1.5 font-mono text-[12px] text-ink focus:border-success-fg focus:outline-none"
              />
            </div>
          )}

          <div>
            <label className="m-0 mb-1 block text-[12px] font-medium text-ink-muted">
              Notes (optional)
            </label>
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Why is this case important?"
              className="w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink focus:border-success-fg focus:outline-none"
            />
          </div>
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          {result && (
            <span
              className={cn(
                'mr-auto text-[12px]',
                result.ok ? 'text-success-fg' : 'text-danger-fg'
              )}
            >
              {result.ok
                ? result.createdDataset
                  ? `Saved (dataset "${datasetName}" created)`
                  : 'Saved to dataset.'
                : `Error: ${result.error}`}
            </span>
          )}
          <button
            type="button"
            onClick={onClose_}
            className="rounded-md border border-line bg-surface px-3 py-1.5 text-[12px] font-medium text-ink hover:bg-surface-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || !datasetName.trim()}
            onClick={handleSave}
            className="inline-flex items-center gap-1.5 rounded-md bg-success-fg px-3 py-1.5 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            Save case
          </button>
        </div>
      </div>
    </div>
  )
}
