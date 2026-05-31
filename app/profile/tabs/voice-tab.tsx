'use client'

import { useState, useTransition } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/app/_components/ui/card'
import { Button } from '@/app/_components/ui/button'
import { Loader2, RefreshCw } from 'lucide-react'
import { regenerateVoice } from '../actions'
import type { VoiceExamples } from '@/lib/types'

interface Props {
  voiceProfile: {
    voice: string | null
    examples: VoiceExamples | null
    updatedAt: string | null
  }
}

export default function VoiceTab({ voiceProfile }: Props) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  function handleRegenerate() {
    setError(null)
    setSuccessMsg(null)
    startTransition(async () => {
      const result = await regenerateVoice()
      if (!result.ok) {
        setError(result.error)
      } else {
        setSuccessMsg('Voice profile updated.')
      }
    })
  }

  return (
    <div className="space-y-4">
      <Card className="bg-surface border-line">
        <CardHeader className="pb-3 pt-5 px-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-[14px] font-semibold text-ink">Writing Voice</CardTitle>
              {voiceProfile.updatedAt && (
                <p className="m-0 mt-0.5 text-[11px] text-ink-faint">
                  Last updated {new Date(voiceProfile.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </p>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRegenerate}
              disabled={pending}
              className="shrink-0 text-[12px] gap-1.5 border-line text-ink-muted hover:text-ink"
            >
              {pending ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              {pending ? 'Regenerating...' : 'Regenerate from last 30 days'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="px-5 pb-5 pt-0">
          {error && (
            <p className="mb-3 text-[12px] rounded-md px-3 py-2 border" style={{ color: 'var(--color-danger-fg)', borderColor: 'var(--color-danger-border)', backgroundColor: 'var(--color-danger-bg)' }}>
              {error}
            </p>
          )}
          {successMsg && (
            <p className="mb-3 text-[12px] rounded-md px-3 py-2" style={{ color: 'var(--color-success-fg)', backgroundColor: 'var(--color-success-bg)' }}>
              {successMsg}
            </p>
          )}
          {voiceProfile.voice ? (
            <pre className="m-0 font-mono text-[12px] text-ink-muted leading-relaxed whitespace-pre-wrap">
              {voiceProfile.voice}
            </pre>
          ) : (
            <p className="m-0 text-[13px] text-ink-faint italic">
              No voice profile yet. Connect Gmail and click "Regenerate" to build one from your sent emails.
            </p>
          )}
        </CardContent>
      </Card>

      {voiceProfile.examples && (
        <div className="grid grid-cols-2 gap-4">
          <ExamplesCard title="Openers" items={voiceProfile.examples.openers} />
          <ExamplesCard title="Closers" items={voiceProfile.examples.closers} />
        </div>
      )}

      <p className="text-[11px] text-ink-faint">
        Your voice profile is generated from sent emails and used only to draft replies on your behalf. It is stored in your account and never shared.
      </p>
    </div>
  )
}

function ExamplesCard({ title, items }: { title: string; items: string[] }) {
  if (!items || items.length === 0) return null
  return (
    <Card className="bg-surface border-line">
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-[12px] font-semibold text-ink-muted uppercase tracking-wider">{title}</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0">
        <ul className="space-y-1.5">
          {items.map((item, i) => (
            <li key={i} className="text-[12px] text-ink-muted font-mono truncate" title={item}>
              "{item}"
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
