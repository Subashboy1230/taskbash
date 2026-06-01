'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ImageIcon, Loader2, Plus, Sparkles, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/app/_components/ui/button'
import { Input } from '@/app/_components/ui/input'
import { Label } from '@/app/_components/ui/label'
import { functionColor } from '@/lib/function-color'
import type { UserFunction } from '@/lib/types'
import { addManualTask, extractTasksFromText } from './actions'

type Priority = 'P0' | 'P1' | 'P2' | 'P3'
type Mode = 'manual' | 'ai'

const PRIORITY_OPTS: Priority[] = ['P0', 'P1', 'P2', 'P3']
const PRIORITY_STYLE: Record<Priority, string> = {
  P0: 'bg-danger-bg text-danger-fg border-danger-border',
  P1: 'bg-tag-reply-bg text-tag-reply-fg border-tag-reply-bg',
  P2: 'bg-tag-action-bg text-tag-action-fg border-tag-action-bg',
  P3: 'bg-surface-muted text-ink-muted border-line',
}

// ─── AI-extracted task preview ───────────────────────────────────────────

interface ExtractedTask {
  title: string
  subtasks: string[]
  due_at: string | null
  priority: string | null
}

export function AddTaskPanel({
  allFunctions,
  onClose,
}: {
  allFunctions: UserFunction[]
  onClose: () => void
}) {
  const [mode, setMode] = useState<Mode>('manual')

  return (
    <aside className="h-full w-full overflow-y-auto bg-surface px-5 py-5">
      <header className="mb-5 pr-10">
        <p className="m-0 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          New task
        </p>
        <h2 className="m-0 mt-1 text-[20px] font-semibold leading-tight text-ink">
          Add a task
        </h2>

        {/* Mode switcher */}
        <div className="mt-3 flex gap-1 rounded-lg border border-line bg-canvas p-0.5">
          <button
            type="button"
            onClick={() => setMode('manual')}
            className={cn(
              'flex-1 rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors',
              mode === 'manual'
                ? 'bg-surface text-ink'
                : 'text-ink-faint hover:text-ink'
            )}
          >
            Manual
          </button>
          <button
            type="button"
            onClick={() => setMode('ai')}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors',
              mode === 'ai'
                ? 'bg-surface text-ink'
                : 'text-ink-faint hover:text-ink'
            )}
          >
            <Sparkles size={12} />
            AI extract
          </button>
        </div>
      </header>

      {mode === 'manual' ? (
        <ManualForm allFunctions={allFunctions} onClose={onClose} />
      ) : (
        <AIForm allFunctions={allFunctions} onClose={onClose} />
      )}
    </aside>
  )
}

// ─── Manual form ─────────────────────────────────────────────────────────

function ManualForm({
  allFunctions,
  onClose,
  initialTitle = '',
  initialSubtasks = [],
  initialDueAt = '',
  initialPriority = null,
}: {
  allFunctions: UserFunction[]
  onClose: () => void
  initialTitle?: string
  initialSubtasks?: string[]
  initialDueAt?: string
  initialPriority?: string | null
}) {
  const router = useRouter()
  const [title, setTitle] = useState(initialTitle)
  const [dueAt, setDueAt] = useState(initialDueAt)
  const [priority, setPriority] = useState<Priority | null>(initialPriority as Priority | null)
  const [functionIds, setFunctionIds] = useState<Set<string>>(new Set())
  const [subtasks, setSubtasks] = useState<string[]>(initialSubtasks.length > 0 ? initialSubtasks : [''])
  const [busy, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const subtaskRefs = useRef<(HTMLInputElement | null)[]>([])

  function toggleFunction(id: string) {
    setFunctionIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function addSubtask() {
    setSubtasks(s => [...s, ''])
    setTimeout(() => {
      subtaskRefs.current[subtasks.length]?.focus()
    }, 0)
  }

  function updateSubtask(idx: number, val: string) {
    setSubtasks(s => s.map((v, i) => i === idx ? val : v))
  }

  function removeSubtask(idx: number) {
    setSubtasks(s => s.filter((_, i) => i !== idx))
  }

  function handleSubtaskKeyDown(e: React.KeyboardEvent, idx: number) {
    if (e.key === 'Enter') {
      e.preventDefault()
      addSubtask()
    } else if (e.key === 'Backspace' && subtasks[idx] === '' && subtasks.length > 1) {
      e.preventDefault()
      removeSubtask(idx)
      setTimeout(() => subtaskRefs.current[idx - 1]?.focus(), 0)
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = title.trim()
    if (!trimmed) { setError('Title is required.'); return }
    setError(null)
    startTransition(async () => {
      try {
        await addManualTask({
          title: trimmed,
          dueAt: dueAt ? new Date(dueAt).toISOString() : null,
          functionIds: Array.from(functionIds),
          priority,
          subtasks: subtasks.map(s => s.trim()).filter(Boolean),
        })
        router.refresh()
        onClose()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to add task')
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Title */}
      <div className="space-y-1.5">
        <Label htmlFor="add-task-title" className="text-ink-muted">Title</Label>
        <Input
          id="add-task-title"
          autoFocus
          value={title}
          onChange={e => { setTitle(e.target.value); setError(null) }}
          placeholder="e.g. Send Q3 OKRs draft to the team"
          disabled={busy}
          className={cn(error && !title.trim() && 'border-danger-border')}
        />
        {error && <p className="m-0 text-[12px] text-danger-fg">{error}</p>}
      </div>

      {/* Priority */}
      <div className="space-y-1.5">
        <Label className="text-ink-muted">Priority</Label>
        <div className="flex gap-1.5">
          {PRIORITY_OPTS.map(p => (
            <button
              key={p}
              type="button"
              onClick={() => setPriority(priority === p ? null : p)}
              disabled={busy}
              className={cn(
                'rounded px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider border transition-all',
                priority === p
                  ? PRIORITY_STYLE[p]
                  : 'border-line bg-transparent text-ink-faint hover:text-ink'
              )}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Due date */}
      <div className="space-y-1.5">
        <Label htmlFor="add-task-due" className="text-ink-muted">Due date</Label>
        <Input id="add-task-due" type="date" value={dueAt} onChange={e => setDueAt(e.target.value)} disabled={busy} />
      </div>

      {/* Subtasks */}
      <div className="space-y-1.5">
        <Label className="text-ink-muted">Subtasks</Label>
        <ul className="m-0 list-none space-y-1.5 p-0">
          {subtasks.map((sub, idx) => (
            <li key={idx} className="flex items-center gap-1.5">
              <span className="text-[11px] text-ink-faint w-4 text-right shrink-0">{idx + 1}.</span>
              <input
                ref={el => { subtaskRefs.current[idx] = el }}
                type="text"
                value={sub}
                onChange={e => updateSubtask(idx, e.target.value)}
                onKeyDown={e => handleSubtaskKeyDown(e, idx)}
                placeholder={`Subtask ${idx + 1}`}
                disabled={busy}
                className="flex-1 rounded-md border border-line bg-canvas px-2.5 py-1.5 text-[13px] text-ink outline-none focus:ring-1 focus:ring-line placeholder:text-ink-faint"
              />
              {subtasks.length > 1 && (
                <button type="button" onClick={() => removeSubtask(idx)} disabled={busy} className="text-ink-faint hover:text-danger-fg">
                  <X size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={addSubtask}
          disabled={busy}
          className="flex items-center gap-1 text-[12px] text-ink-faint hover:text-ink"
        >
          <Plus size={12} /> Add subtask
        </button>
        <p className="m-0 text-[11px] text-ink-faint">Enter to add, Backspace on empty to remove.</p>
      </div>

      {/* Functions */}
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
                  className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors disabled:opacity-50"
                  style={
                    isOn
                      ? { backgroundColor: c, borderColor: c, color: '#0a0a0a' }
                      : { backgroundColor: 'transparent', borderColor: c + '66', color: c }
                  }
                >
                  <span className="inline-block size-1.5 rounded-full" style={{ backgroundColor: isOn ? '#0a0a0a' : c }} />
                  {fn.name}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 pt-2">
        <Button type="submit" disabled={busy || !title.trim()} className="gap-1.5">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          Create task
        </Button>
        <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
      </div>
    </form>
  )
}

// ─── Image resize helper (client-side, max 1024px) ───────────────────────

async function resizeImageToBase64(
  file: File,
  maxPx = 1024
): Promise<{ base64: string; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height))
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
      // Always output JPEG for screenshots (smaller than PNG)
      const base64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1]
      resolve({ base64, mediaType: 'image/jpeg' })
    }
    img.onerror = reject
    img.src = url
  })
}

// ─── AI extract form ──────────────────────────────────────────────────────

function AIForm({
  allFunctions,
  onClose,
}: {
  allFunctions: UserFunction[]
  onClose: () => void
}) {
  const [text, setText] = useState('')
  const [image, setImage] = useState<{ base64: string; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'; previewUrl: string } | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [extracted, setExtracted] = useState<ExtractedTask[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [committing, setCommitting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  async function handleImageFile(file: File) {
    setError(null)
    try {
      const { base64, mediaType } = await resizeImageToBase64(file)
      const previewUrl = URL.createObjectURL(file)
      setImage({ base64, mediaType, previewUrl })
    } catch {
      setError('Could not read image. Try a JPEG or PNG.')
    }
  }

  function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleImageFile(file)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (file && file.type.startsWith('image/')) handleImageFile(file)
  }

  function removeImage() {
    if (image) URL.revokeObjectURL(image.previewUrl)
    setImage(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleExtract() {
    if (!text.trim() && !image) return
    setExtracting(true)
    setError(null)
    setExtracted(null)
    const result = await extractTasksFromText({
      text,
      imageBase64: image?.base64,
      imageMediaType: image?.mediaType,
    })
    setExtracting(false)
    if (!result.ok) { setError(result.error); return }
    if (result.tasks.length === 0) { setError('No actionable tasks found. Try adding more detail or a clearer image.'); return }
    setExtracted(result.tasks)
  }

  async function handleCommit() {
    if (!extracted) return
    setCommitting(true)
    try {
      for (const task of extracted) {
        await addManualTask({
          title: task.title,
          dueAt: task.due_at,
          priority: task.priority,
          subtasks: task.subtasks,
        })
      }
      router.refresh()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create tasks')
      setCommitting(false)
    }
  }

  function removeTask(idx: number) {
    setExtracted(prev => prev ? prev.filter((_, i) => i !== idx) : prev)
  }

  if (extracted) {
    return (
      <div className="space-y-4">
        <p className="m-0 text-[13px] text-ink-muted">
          {extracted.length} task{extracted.length !== 1 ? 's' : ''} extracted. Review and add to your list.
        </p>

        <ul className="m-0 list-none space-y-2 p-0">
          {extracted.map((task, idx) => (
            <li key={idx} className="rounded-lg border border-line bg-canvas px-3 py-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {task.priority && (
                      <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider border', PRIORITY_STYLE[task.priority as Priority] ?? 'border-line text-ink-faint')}>
                        {task.priority}
                      </span>
                    )}
                    <span className="text-[14px] font-semibold text-ink">{task.title}</span>
                    {task.due_at && (
                      <span className="text-[11px] text-ink-faint">
                        Due {new Date(task.due_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    )}
                  </div>
                  {task.subtasks.length > 0 && (
                    <ul className="m-0 mt-1.5 list-none space-y-0.5 p-0 pl-1">
                      {task.subtasks.map((s, si) => (
                        <li key={si} className="text-[12px] text-ink-muted before:mr-1.5 before:content-['-']">{s}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <button type="button" onClick={() => removeTask(idx)} className="shrink-0 text-ink-faint hover:text-danger-fg mt-0.5">
                  <Trash2 size={13} />
                </button>
              </div>
            </li>
          ))}
        </ul>

        {error && <p className="m-0 text-[12px] text-danger-fg">{error}</p>}

        <div className="flex items-center gap-2 pt-1">
          <Button onClick={handleCommit} disabled={committing || extracted.length === 0} className="gap-1.5">
            {committing ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Add {extracted.length} task{extracted.length !== 1 ? 's' : ''}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setExtracted(null)}>Back</Button>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <p className="m-0 text-[13px] text-ink-muted">
        Paste notes, type a brain dump, or attach a screenshot. AI extracts the tasks.
      </p>

      {/* Image drop zone / preview */}
      {image ? (
        <div className="relative rounded-lg border border-line overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image.previewUrl} alt="Attached screenshot" className="w-full max-h-48 object-contain bg-canvas" />
          <button
            type="button"
            onClick={removeImage}
            className="absolute right-2 top-2 rounded-full bg-surface p-1 text-ink-faint hover:text-danger-fg shadow"
            title="Remove image"
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <div
          onDrop={handleDrop}
          onDragOver={e => e.preventDefault()}
          onClick={() => fileInputRef.current?.click()}
          className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-line bg-canvas px-4 py-5 text-center hover:border-ink-faint transition-colors"
        >
          <ImageIcon size={20} className="text-ink-faint" />
          <p className="m-0 text-[12px] text-ink-faint">
            Drop a screenshot here, or <span className="underline">click to browse</span>
          </p>
          <p className="m-0 text-[11px] text-ink-faint">JPEG, PNG, WEBP</p>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={handleFilePick}
      />

      {/* Text input */}
      <div className="space-y-1.5">
        <Label htmlFor="ai-input" className="text-ink-muted">
          Notes <span className="text-ink-faint font-normal">(optional if image attached)</span>
        </Label>
        <textarea
          id="ai-input"
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="e.g. Need to send the deck to Sarah by Friday, follow up with Jason about the contract..."
          rows={5}
          disabled={extracting}
          className="w-full resize-none rounded-md border border-line bg-canvas px-3 py-2.5 text-[13px] text-ink outline-none focus:ring-1 focus:ring-line placeholder:text-ink-faint disabled:opacity-60"
        />
      </div>

      {error && <p className="m-0 text-[12px] text-danger-fg">{error}</p>}

      <div className="flex items-center gap-2">
        <Button onClick={handleExtract} disabled={extracting || (!text.trim() && !image)} className="gap-1.5">
          {extracting ? (
            <><Loader2 size={14} className="animate-spin" /> Extracting...</>
          ) : (
            <><Sparkles size={14} /> Extract tasks</>
          )}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose} disabled={extracting}>Cancel</Button>
      </div>
    </div>
  )
}
