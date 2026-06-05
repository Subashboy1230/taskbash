'use client'

// Functions CRUD UI — list, add, rename, recolor, delete. Optimistic.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Check, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { functionColor } from '@/lib/function-color'
import type { UserFunction } from '@/lib/types'
import { Button } from '@/app/_components/ui/button'
import { Input } from '@/app/_components/ui/input'
import {
  createFunction,
  deleteFunction,
  renameFunction,
  seedDefaultFunctions,
  setFunctionColor,
} from './actions'

// Subash's starter set. Short names so the chips don't wrap on
// task rows. Hand-tuned colors come from lib/function-color name
// overrides so the chips read with distinct hues.
const DEFAULT_FUNCTIONS = [
  'Product',
  'Ops',
  'QA',
  'Hiring',
  'GTM',
]

// Pre-baked palette for the swatch picker. Matches load-functions
// fallback colors so the picker looks consistent with auto-assigned chips.
const PALETTE = [
  '#7B68EE', '#1D9E75', '#D85A30', '#0C447C',
  '#993556', '#854F0B', '#3B6D11', '#A32D2D',
]

export function FunctionsManager({ initial }: { initial: UserFunction[] }) {
  const router = useRouter()
  const [list, setList] = useState(initial)
  const [draft, setDraft] = useState('')
  const [busy, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function refresh() {
    router.refresh()
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const name = draft.trim()
    if (!name) return
    setError(null)
    const tempId = `temp-${Date.now()}`
    const optimistic: UserFunction = {
      id: tempId,
      user_id: '',
      name,
      color: null,
      sort_order: 9999,
      created_at: new Date().toISOString(),
      deleted_at: null,
    }
    setList(prev => [...prev, optimistic])
    setDraft('')
    startTransition(async () => {
      try {
        await createFunction({ name })
        toast.success(`Added "${name}"`)
        refresh()
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Add failed'
        toast.error("Couldn't add function", { description: msg })
        setList(prev => prev.filter(f => f.id !== tempId))
      }
    })
  }

  function handleSeed() {
    setError(null)
    startTransition(async () => {
      try {
        await seedDefaultFunctions(DEFAULT_FUNCTIONS)
        toast.success('Seeded default functions')
        refresh()
      } catch (e) {
        toast.error("Couldn't seed defaults", {
          description: e instanceof Error ? e.message : 'Try again.',
        })
      }
    })
  }

  function handleDelete(fn: UserFunction) {
    const ok = window.confirm(
      `Delete "${fn.name}"? This removes the tag from every task it's assigned to. This cannot be undone.`
    )
    if (!ok) return
    setError(null)
    setList(prev => prev.filter(f => f.id !== fn.id))
    deleteFunction(fn.id)
      .then(() => toast.success(`Deleted "${fn.name}"`))
      .catch(err => {
        setList(prev => [...prev, fn])
        toast.error(`Couldn't delete "${fn.name}"`, {
          description: err instanceof Error ? err.message : 'Check your connection and try again.',
        })
      })
  }

  return (
    <section className="space-y-5">
      {list.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-10 text-center">
          <p className="m-0 text-[15px] font-medium text-ink">
            No functions yet
          </p>
          <p className="mt-1 text-[13px] text-ink-faint m-0">
            Add a function below, or seed the defaults to get started fast.
          </p>
          <Button onClick={handleSeed} disabled={busy} size="sm" className="mt-3">
            {busy && <Loader2 size={12} className="animate-spin" />}
            Seed defaults ({DEFAULT_FUNCTIONS.join(', ')})
          </Button>
        </div>
      ) : (
        <ul className="list-none p-0 m-0 space-y-2">
          {list.map(fn => (
            <FunctionRow
              key={fn.id}
              fn={fn}
              onDelete={() => handleDelete(fn)}
              onRenamed={refresh}
              onRecolored={refresh}
            />
          ))}
        </ul>
      )}

      <form onSubmit={handleAdd} className="flex items-center gap-2">
        <Input
          type="text"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="Add a function (e.g. Fundraising)"
          disabled={busy}
          className="flex-1"
        />
        <Button type="submit" disabled={busy || !draft.trim()}>
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
          Add
        </Button>
      </form>

      {error && (
        <p className="m-0 text-[12px] text-danger-fg">{error}</p>
      )}
    </section>
  )
}

function FunctionRow({
  fn,
  onDelete,
  onRenamed,
  onRecolored,
}: {
  fn: UserFunction
  onDelete: () => void
  onRenamed: () => void
  onRecolored: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(fn.name)
  const [pickingColor, setPickingColor] = useState(false)
  const [busy, startTransition] = useTransition()

  const color = functionColor(fn)

  function handleSaveName() {
    const trimmed = name.trim()
    if (!trimmed || trimmed === fn.name) {
      setEditing(false)
      return
    }
    startTransition(async () => {
      try {
        await renameFunction(fn.id, trimmed)
        setEditing(false)
        onRenamed()
      } catch {
        setName(fn.name)
        setEditing(false)
      }
    })
  }

  function handlePickColor(c: string | null) {
    startTransition(async () => {
      await setFunctionColor(fn.id, c)
      setPickingColor(false)
      onRecolored()
    })
  }

  return (
    <li className="flex items-center gap-3 rounded-lg border border-line/60 bg-surface px-3 py-2.5">
      <button
        type="button"
        onClick={() => setPickingColor(p => !p)}
        className="relative size-6 shrink-0 rounded-md ring-1 ring-line/60 hover:ring-line-strong"
        style={{ backgroundColor: color }}
        aria-label="Change color"
        title="Change color"
      />
      {editing ? (
        <Input
          autoFocus
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          onBlur={handleSaveName}
          onKeyDown={e => {
            if (e.key === 'Enter') handleSaveName()
            if (e.key === 'Escape') {
              setName(fn.name)
              setEditing(false)
            }
          }}
          className="flex-1 h-7 text-[14px]"
        />
      ) : (
        <span
          className="flex-1 cursor-text text-[14px] font-medium text-ink"
          onClick={() => setEditing(true)}
        >
          {fn.name}
        </span>
      )}
      <Button
        variant="ghost"
        size="icon"
        type="button"
        onClick={() => setEditing(true)}
        disabled={busy || editing}
        aria-label="Rename"
        className="h-7 w-7 text-ink-faint hover:text-ink"
      >
        <Pencil size={13} />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        type="button"
        onClick={onDelete}
        disabled={busy}
        aria-label={`Delete ${fn.name}`}
        className="h-7 w-7 text-ink-faint hover:bg-danger-bg hover:text-danger-fg"
      >
        <Trash2 size={13} />
      </Button>

      {pickingColor && (
        <div className="absolute z-10 mt-12 ml-0 flex gap-1 rounded-md border border-line bg-surface p-1.5 shadow-md">
          {PALETTE.map(c => (
            <button
              key={c}
              type="button"
              onClick={() => handlePickColor(c)}
              className={cn(
                'size-5 rounded ring-1 ring-line/60 hover:ring-line-strong',
                fn.color === c && 'ring-2 ring-ink ring-offset-1'
              )}
              style={{ backgroundColor: c }}
              aria-label={c}
            />
          ))}
          <button
            type="button"
            onClick={() => handlePickColor(null)}
            className="flex size-5 items-center justify-center rounded text-ink-faint hover:bg-surface-muted"
            title="Reset to auto"
          >
            <X size={11} />
          </button>
        </div>
      )}
    </li>
  )
}

// Suppress unused-import warning for icons used inside JSX paths only.
void Check
