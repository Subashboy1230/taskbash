// Inline entity pill for people, projects, and threads extracted from emails.
// Renders inline inside the task row subtitle, e.g. @Karttikeya, @EverTutor.

import React from 'react'
import { cn } from '@/lib/utils'

export interface Entity {
  kind: 'person' | 'project' | 'thread' | string
  label: string
  ref?: string
}

export function EntityChip({ entity }: { entity: Entity }) {
  const dotColor =
    entity.kind === 'person'
      ? 'bg-green-400'
      : entity.kind === 'project'
      ? 'bg-blue-400'
      : 'bg-orange-400'

  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded-full border border-line bg-surface-muted px-1.5 py-0.5 text-[11px] font-medium text-ink-muted'
    )}>
      <span className={cn('size-1.5 shrink-0 rounded-full', dotColor)} />
      @{entity.label}
    </span>
  )
}

/**
 * Given a subtitle string and entity list, render the subtitle with entity
 * labels wrapped in EntityChip components. Returns an array of React nodes.
 */
export function renderSubtitleWithEntities(
  subtitle: string,
  entities: Entity[]
): React.ReactNode[] {
  if (!entities || entities.length === 0) return [subtitle]

  // Sort entities by label length descending so longer names match first
  const sorted = [...entities].sort((a, b) => b.label.length - a.label.length)

  // Build a list of segments: string or entity index
  type Segment = { type: 'text'; text: string } | { type: 'entity'; entity: Entity }
  const segments: Segment[] = [{ type: 'text', text: subtitle }]

  for (const entity of sorted) {
    const next: Segment[] = []
    for (const seg of segments) {
      if (seg.type !== 'text') {
        next.push(seg)
        continue
      }
      const idx = seg.text.indexOf(entity.label)
      if (idx === -1) {
        next.push(seg)
        continue
      }
      if (idx > 0) next.push({ type: 'text', text: seg.text.slice(0, idx) })
      next.push({ type: 'entity', entity })
      const after = seg.text.slice(idx + entity.label.length)
      if (after) next.push({ type: 'text', text: after })
    }
    segments.splice(0, segments.length, ...next)
  }

  return segments.map((seg, i) =>
    seg.type === 'text'
      ? seg.text
      : <EntityChip key={i} entity={seg.entity} />
  )
}
