'use client'

import { useState, useTransition } from 'react'
import type { WhatsAppSettings } from '@/lib/whatsapp'
import { saveWhatsAppSettings, disconnectWhatsApp, sendTestDigest } from './actions'

const COMMON_TZ = [
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'Europe/London',
  'Asia/Singapore',
  'Asia/Tokyo',
  'UTC',
]

export function WhatsAppSettingsForm({ initial }: { initial: WhatsAppSettings | null }) {
  const [e164, setE164] = useState(initial?.e164 ?? '')
  const [morning, setMorning] = useState(initial?.morningDigestEnabled ?? false)
  const [meeting, setMeeting] = useState(initial?.meetingRemindersEnabled ?? false)
  const [digestTime, setDigestTime] = useState(initial?.digestTimeLocal ?? '09:00')
  const [quietBefore, setQuietBefore] = useState(initial?.quietBefore ?? '06:30')
  const [quietAfter, setQuietAfter] = useState(initial?.quietAfter ?? '22:00')
  const [timezone, setTimezone] = useState(initial?.timezone ?? 'America/Los_Angeles')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, start] = useTransition()

  function onSave() {
    setError(null); setSaved(false)
    start(async () => {
      const result = await saveWhatsAppSettings({
        e164,
        morningDigestEnabled: morning,
        meetingRemindersEnabled: meeting,
        digestTimeLocal: digestTime,
        quietBefore,
        quietAfter,
        timezone,
      })
      if (result.ok) setSaved(true)
      else setError(result.error)
    })
  }

  function onDisconnect() {
    if (!confirm('Disconnect WhatsApp? All toggles will turn off.')) return
    setError(null); setSaved(false)
    start(async () => {
      const result = await disconnectWhatsApp()
      if (result.ok) {
        setE164(''); setMorning(false); setMeeting(false)
        setSaved(true)
      } else setError(result.error)
    })
  }

  function onTest() {
    setError(null); setSaved(false)
    start(async () => {
      const result = await sendTestDigest()
      if (result.ok) setSaved(true)
      else setError(result.error)
    })
  }

  return (
    <form action={onSave} className="mt-8 space-y-6">
      {/* Phone */}
      <Field label="WhatsApp phone (E.164)" hint="With + and country code. e.g. +14155551234.">
        <input
          type="tel"
          inputMode="tel"
          value={e164}
          onChange={e => setE164(e.target.value.trim())}
          placeholder="+14155551234"
          className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:ring-1 focus:ring-ink"
          required
          pattern="\+[1-9]\d{6,14}"
        />
      </Field>

      {/* Toggles */}
      <Field label="What to send" hint="You can change these anytime.">
        <Toggle
          label="Morning digest"
          description={`Daily summary at ${digestTime} local.`}
          checked={morning}
          onChange={setMorning}
        />
        <Toggle
          label="Meeting reminders"
          description="10 minutes before each Google Calendar event."
          checked={meeting}
          onChange={setMeeting}
        />
      </Field>

      {/* Timing */}
      <div className="grid grid-cols-2 gap-4">
        <Field label="Digest time">
          <input
            type="time"
            value={digestTime}
            onChange={e => setDigestTime(e.target.value)}
            className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:ring-1 focus:ring-ink"
          />
        </Field>
        <Field label="Timezone">
          <select
            value={timezone}
            onChange={e => setTimezone(e.target.value)}
            className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:ring-1 focus:ring-ink"
          >
            {COMMON_TZ.map(tz => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Quiet hours start (no messages before)">
          <input
            type="time"
            value={quietBefore}
            onChange={e => setQuietBefore(e.target.value)}
            className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:ring-1 focus:ring-ink"
          />
        </Field>
        <Field label="Quiet hours end (no messages after)">
          <input
            type="time"
            value={quietAfter}
            onChange={e => setQuietAfter(e.target.value)}
            className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:ring-1 focus:ring-ink"
          />
        </Field>
      </div>

      {error && (
        <p className="rounded-md border border-danger-border bg-danger-bg px-3 py-2 text-xs text-danger-fg">
          {error}
        </p>
      )}
      {saved && (
        <p className="rounded-md border border-success-fg/30 bg-success-bg px-3 py-2 text-xs text-success-fg">
          Saved.
        </p>
      )}

      <div className="flex items-center gap-3 pt-2">
        <button
          type="button"
          onClick={onSave}
          disabled={pending}
          className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-canvas disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onTest}
          disabled={pending || !initial}
          className="rounded-md border border-line bg-surface px-4 py-2 text-sm text-ink hover:bg-surface-muted disabled:opacity-50"
        >
          Send test digest
        </button>
        {initial && (
          <button
            type="button"
            onClick={onDisconnect}
            disabled={pending}
            className="ml-auto rounded-md border border-line bg-surface px-4 py-2 text-sm text-ink-muted hover:border-danger-fg hover:text-danger-fg"
          >
            Disconnect
          </button>
        )}
      </div>
    </form>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-sm font-medium text-ink">{label}</div>
      {hint && <div className="mb-2 text-xs text-ink-muted">{hint}</div>}
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function Toggle({
  label, description, checked, onChange,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-start gap-3 rounded-md border border-line bg-surface px-3 py-2 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="mt-0.5"
      />
      <div>
        <div className="text-sm text-ink">{label}</div>
        <div className="text-xs text-ink-muted">{description}</div>
      </div>
    </label>
  )
}
