'use client'

import { useState, useTransition } from 'react'
import { Card, CardContent } from '@/app/_components/ui/card'
import { Button } from '@/app/_components/ui/button'
import { Textarea } from '@/app/_components/ui/textarea'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { suggestPromptEdit } from '../actions'
import type { PromptDef } from '@/lib/prompt-registry'

interface PromptRow extends PromptDef {
  slopRate: number | null
}

interface Props {
  prompts: PromptRow[]
}

export default function PromptsTab({ prompts }: Props) {
  return (
    <div className="space-y-2">
      {prompts.map(p => (
        <PromptCard key={p.id} prompt={p} />
      ))}
    </div>
  )
}

function PromptCard({ prompt }: { prompt: PromptRow }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <Card className="bg-surface border-line overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-muted/30 transition-colors"
      >
        {expanded ? <ChevronDown size={14} className="shrink-0 text-ink-faint" /> : <ChevronRight size={14} className="shrink-0 text-ink-faint" />}
        <span className="flex-1 min-w-0">
          <span className="text-[13px] font-medium text-ink">{prompt.shortName}</span>
          <span className="ml-2 text-[11px] text-ink-faint font-mono">{prompt.id}</span>
          <span className="ml-1.5 text-[11px] text-ink-faint">v{prompt.version}</span>
        </span>
        <SlopBadge rate={prompt.slopRate} />
      </button>

      {expanded && (
        <CardContent className="px-4 pb-4 pt-0 border-t border-line">
          <p className="mt-3 mb-2 text-[11px] text-ink-faint uppercase tracking-wider font-semibold">System prompt</p>
          <pre className="text-[11px] font-mono text-ink-muted leading-relaxed whitespace-pre-wrap bg-surface-muted/50 rounded-md px-3 py-3 max-h-64 overflow-y-auto border border-line">
            {prompt.text}
          </pre>
          <SuggestForm promptId={prompt.id} version={prompt.version} />
        </CardContent>
      )}
    </Card>
  )
}

function SlopBadge({ rate }: { rate: number | null }) {
  if (rate === null) {
    return (
      <span className="text-[11px] px-2 py-0.5 rounded-full text-ink-faint bg-surface-muted">
        no data
      </span>
    )
  }
  const color =
    rate < 15
      ? { bg: 'var(--color-success-bg)', fg: 'var(--color-success-fg)' }
      : rate < 30
      ? { bg: 'var(--color-tag-action-bg)', fg: 'var(--color-tag-action-fg)' }
      : { bg: 'var(--color-danger-bg)', fg: 'var(--color-danger-fg)' }

  return (
    <span
      className="text-[11px] px-2 py-0.5 rounded-full font-medium"
      style={{ backgroundColor: color.bg, color: color.fg }}
    >
      {rate}% slop
    </span>
  )
}

function SuggestForm({ promptId, version }: { promptId: string; version: number }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [pending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null)

  function handleSubmit() {
    setFeedback(null)
    startTransition(async () => {
      const result = await suggestPromptEdit({ promptId, currentVersion: version, suggestion: text })
      if (result.ok) {
        setFeedback({ ok: true, msg: 'Suggestion submitted.' })
        setText('')
        setOpen(false)
      } else {
        setFeedback({ ok: false, msg: result.error })
      }
    })
  }

  if (!open) {
    return (
      <div className="mt-3">
        {feedback && (
          <p className="mb-2 text-[12px]" style={{ color: feedback.ok ? 'var(--color-success-fg)' : 'var(--color-danger-fg)' }}>
            {feedback.msg}
          </p>
        )}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-[12px] text-ink-faint hover:text-ink underline underline-offset-2"
        >
          Suggest an improvement
        </button>
      </div>
    )
  }

  return (
    <div className="mt-3 space-y-2">
      <p className="text-[12px] text-ink-muted">Describe what should change and why:</p>
      <Textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="e.g. The prompt should skip internal emails from noreply addresses..."
        className="text-[12px] bg-surface-muted/50 border-line text-ink placeholder:text-ink-faint min-h-[80px]"
        maxLength={5000}
      />
      {feedback && !feedback.ok && (
        <p className="text-[12px]" style={{ color: 'var(--color-danger-fg)' }}>{feedback.msg}</p>
      )}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={pending || !text.trim()}
          className="text-[12px]"
        >
          {pending ? 'Submitting...' : 'Submit'}
        </Button>
        <button
          type="button"
          onClick={() => { setOpen(false); setFeedback(null) }}
          className="text-[12px] text-ink-faint hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
