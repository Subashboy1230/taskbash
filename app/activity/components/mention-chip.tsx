import { cn } from '@/lib/utils'

type MentionKind = 'person' | 'project' | 'thread'

const DOT: Record<MentionKind, string> = {
  person:  'bg-emerald-400',
  project: 'bg-blue-400',
  thread:  'bg-orange-400',
}

export function MentionChip({ kind, label }: { kind: MentionKind; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-1.5 py-0.5 text-[11px] text-ink-muted">
      <span className={cn('size-1.5 rounded-full shrink-0', DOT[kind] ?? 'bg-ink-faint')} />
      {label}
    </span>
  )
}

export function renderMentions(text: string): React.ReactNode[] {
  const pattern = /@\[([^\]]+)\]\(([^:]+):([^)]+)\)/g
  const parts: React.ReactNode[] = []
  let last = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    const [, label, kind] = match
    parts.push(
      <MentionChip key={match.index} kind={kind as MentionKind} label={label} />
    )
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}
