'use client'

// Slide-over panel for creating a manual task. Mirrors the DetailPanel
// shape so it feels like the same surface. Renders inside a Sheet that
// the shell controls.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/app/_components/ui/button'
import { Input } from '@/app/_components/ui/input'
import { Label } from '@/app/_components/ui/label'
import { functionColor } from '@/lib/function-color'
import type { UserFunction } from '@/lib/types'
import { addManualTask } from './actions'

export function AddTaskPanel({
  allFunctions,
  onClose,
}: {
  allFunctions: UserFunction[]
  onClose: () => void
}) {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [functionIds, setFunctionIds] = useState<Set<string>>(new Set())
  const [busy, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function toggleFunction(id: string) {
    setFunctionIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = title.trim()
    if (!trimmed) {
      setError('Task title is required.')
      return
    }
    setError(null)
    startTransition(async () => {
      try {
        await addManualTask({
          title: trimmed,
          dueAt: dueAt ? new Date(dueAt).toISOString() : null,
          functionIds: Array.from(functionIds),
        })
        router.refresh()
        onClose()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to add task')
      }
    })
  }

  return (
    <aside className="h-full w-full overflow-y-auto bg-surface px-5 py-5">
      <header className="mb-6 pr-10">
        <p className="m-0 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          New task
        </p>
        <h2 className="m-0 mt-1 text-[20px] font-semibold leading-tight text-ink">
          Add a manual task
        </h2>
        <p className="m-0 mt-1 text-[13px] text-ink-muted">
          Quick capture for work you want on the list but isn&apos;t coming
          from a source.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="add-task-title" className="text-ink-muted">
            Title
          </Label>
          <Input
            id="add-task-title"
            autoFocus
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="e.g. Send Q3 OKRs draft to the team"
            disabled={busy}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="add-task-due" className="text-ink-muted">
            Due date
          </Label>
          <Input
            id="add-task-due"
            type="date"
            value={dueAt}
            onChange={e => setDueAt(e.target.value)}
            disabled={busy}
          />
          <p className="m-0 text-[11px] text-ink-faint">
            Optional. The task appears on the calendar on that day.
          </p>
        </div>

        {allFunctions.length > 0 && (
          <div className="space-y-1.5">
            <Label className="text-ink-muted">Functions</Label>
            <div className="flex flex-wrap gap-1.5">
              {allFunctions.map(fn => {
                const isOn = functionIds.has(fn.id)
                const c = functionColor(fn)
                return (
                  <button
                    key={fn.id}
                    type="button"
                    onClick={() => toggleFunction(fn.id)}
                    disabled={busy}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors disabled:opacity-50'
                    )}
                    style={
                      isOn
                        ? { backgroundColor: c, borderColor: c, color: '#0a0a0a' }
                        : { backgroundColor: 'transparent', borderColor: c + '66', color: c }
                    }
                  >
                    <span
                      className="inline-block size-1.5 rounded-full"
                      style={{ backgroundColor: isOn ? '#0a0a0a' : c }}
                    />
                    {fn.name}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {error && (
          <p className="m-0 rounded-md border border-danger-border bg-danger-bg px-3 py-2 text-[12px] text-danger-fg">
            {error}
          </p>
        )}

        <div className="flex items-center gap-2 pt-2">
          <Button type="submit" disabled={busy || !title.trim()} className="gap-1.5">
            {busy ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Plus size={14} />
            )}
            Create task
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </Button>
        </div>
      </form>
    </aside>
  )
}
