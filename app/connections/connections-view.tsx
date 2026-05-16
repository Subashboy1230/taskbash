'use client'

// Connections settings page — Connect / Disconnect each source.
//
// Gmail uses Nango OAuth: click Connect → server mints a session token → the
// Nango frontend SDK opens an OAuth popup → on success, we persist the
// resulting connection ID to our DB.
//
// Granola uses an API key: click Connect → form appears → user pastes their
// key → we persist it directly. (Granola has no OAuth public flow.)

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Mail,
  Mic,
  MessageSquare,
  Calendar as CalendarIcon,
  Check,
  X,
  Loader2,
} from 'lucide-react'
import type { Connection, ConnectionProvider } from '@/lib/types'
import {
  createNangoConnectSession,
  recordNangoConnection,
  recordGranolaApiKey,
  disconnectProvider,
} from './actions'

interface Source {
  provider: ConnectionProvider | 'slack'
  name: string
  description: string
  icon: typeof Mail
  authType: 'oauth' | 'apikey' | 'unavailable'
}

const SOURCES: Source[] = [
  {
    provider: 'gmail',
    name: 'Gmail',
    description: 'Read recent inbox threads for action items you owe.',
    icon: Mail,
    authType: 'oauth',
  },
  {
    provider: 'calendar',
    name: 'Google Calendar',
    description: 'Generate prep briefs for upcoming meetings (next 36 hours).',
    icon: CalendarIcon,
    authType: 'oauth',
  },
  {
    provider: 'granola',
    name: 'Granola',
    description: 'Pull post-call commitments from your meeting notes.',
    icon: Mic,
    authType: 'apikey',
  },
  {
    provider: 'slack',
    name: 'Slack',
    description: 'DMs and channels — coming in Week 5 (needs auth feature).',
    icon: MessageSquare,
    authType: 'unavailable',
  },
]

export function ConnectionsView({
  connections,
}: {
  connections: Connection[]
}) {
  const byProvider = new Map(connections.map(c => [c.provider, c]))
  return (
    <div className="min-h-screen bg-canvas">
      <main className="mx-auto max-w-[920px] px-8 pt-8 pb-16">
        <header className="mb-8">
          <h1 className="m-0 text-[28px] font-semibold tracking-tight text-ink">
            Connections
          </h1>
          <p className="mt-1 text-[14px] text-ink-faint">
            Sources ToDoo pulls action items from. Connect what you use; the
            morning digest reads from anything that's active here.
          </p>
        </header>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {SOURCES.map(source => (
            <ConnectionCard
              key={source.provider}
              source={source}
              connection={byProvider.get(source.provider) ?? null}
            />
          ))}
        </div>
      </main>
    </div>
  )
}

function ConnectionCard({
  source,
  connection,
}: {
  source: Source
  connection: Connection | null
}) {
  const Icon = source.icon
  const isActive = connection?.status === 'active'
  return (
    <div className="rounded-lg border border-line/60 bg-surface p-4">
      <div className="flex items-start gap-3">
        <div className="flex size-10 items-center justify-center rounded-md bg-surface-muted text-ink-faint">
          <Icon size={20} />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="m-0 text-[15px] font-semibold text-ink">
              {source.name}
            </h3>
            <StatusBadge
              status={
                source.authType === 'unavailable'
                  ? 'unavailable'
                  : isActive
                  ? 'connected'
                  : 'disconnected'
              }
            />
          </div>
          <p className="mt-1 text-[13px] text-ink-faint">{source.description}</p>
        </div>
      </div>
      <div className="mt-4 flex justify-end">
        <ConnectionAction source={source} isActive={isActive} />
      </div>
    </div>
  )
}

function StatusBadge({
  status,
}: {
  status: 'connected' | 'disconnected' | 'unavailable'
}) {
  if (status === 'connected') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2 py-0.5 text-[11px] font-medium text-success-fg">
        <Check size={11} /> Connected
      </span>
    )
  }
  if (status === 'unavailable') {
    return (
      <span className="inline-flex items-center rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-medium text-ink-faint">
        Coming soon
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-medium text-ink-faint">
      Not connected
    </span>
  )
}

function ConnectionAction({
  source,
  isActive,
}: {
  source: Source
  isActive: boolean
}) {
  const router = useRouter()
  const [busy, startBusy] = useTransition()
  const [showApiKeyForm, setShowApiKeyForm] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (source.authType === 'unavailable') {
    return (
      <button
        disabled
        className="rounded-md border border-line bg-surface px-3 py-1.5 text-[12px] font-medium text-ink-faint opacity-60"
      >
        Coming soon
      </button>
    )
  }

  if (isActive) {
    return (
      <div className="flex flex-col items-end gap-1">
        <button
          disabled={busy}
          onClick={() =>
            startBusy(async () => {
              setError(null)
              try {
                await disconnectProvider(
                  source.provider as ConnectionProvider
                )
                router.refresh()
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Disconnect failed')
              }
            })
          }
          className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-3 py-1.5 text-[12px] font-medium text-ink hover:border-line-strong disabled:opacity-50"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
          Disconnect
        </button>
        {error && <span className="text-[11px] text-danger-fg">{error}</span>}
      </div>
    )
  }

  // Granola — API key form, inline.
  if (source.authType === 'apikey') {
    if (showApiKeyForm) {
      return (
        <GranolaApiKeyForm
          onCancel={() => {
            setShowApiKeyForm(false)
            setError(null)
          }}
          onError={setError}
          error={error}
        />
      )
    }
    return (
      <button
        onClick={() => setShowApiKeyForm(true)}
        className="inline-flex items-center gap-1.5 rounded-md bg-success-fg px-3 py-1.5 text-[12px] font-semibold text-white hover:opacity-90"
      >
        Connect
      </button>
    )
  }

  // Gmail (or future OAuth provider) — Nango OAuth popup.
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        disabled={busy}
        onClick={() =>
          startBusy(async () => {
            setError(null)
            try {
              await connectViaNango(source.provider as ConnectionProvider)
              router.refresh()
            } catch (err) {
              setError(
                err instanceof Error ? err.message : 'Connection failed'
              )
            }
          })
        }
        className="inline-flex items-center gap-1.5 rounded-md bg-success-fg px-3 py-1.5 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
      >
        {busy && <Loader2 size={12} className="animate-spin" />}
        Connect
      </button>
      {error && <span className="text-[11px] text-danger-fg">{error}</span>}
    </div>
  )
}

function GranolaApiKeyForm({
  onCancel,
  onError,
  error,
}: {
  onCancel: () => void
  onError: (msg: string | null) => void
  error: string | null
}) {
  const router = useRouter()
  const [apiKey, setApiKey] = useState('')
  const [busy, startBusy] = useTransition()
  return (
    <form
      onSubmit={e => {
        e.preventDefault()
        startBusy(async () => {
          onError(null)
          try {
            await recordGranolaApiKey(apiKey)
            router.refresh()
          } catch (err) {
            onError(err instanceof Error ? err.message : 'Save failed')
          }
        })
      }}
      className="flex flex-col items-end gap-2"
    >
      <input
        type="password"
        value={apiKey}
        onChange={e => setApiKey(e.target.value)}
        placeholder="grn_..."
        autoFocus
        className="w-64 rounded-md border border-line bg-surface px-2 py-1 text-[12px] text-ink placeholder:text-ink-faint focus:border-success-fg focus:outline-none"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-line bg-surface px-3 py-1.5 text-[12px] font-medium text-ink hover:border-line-strong"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy || !apiKey}
          className="inline-flex items-center gap-1.5 rounded-md bg-success-fg px-3 py-1.5 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          {busy && <Loader2 size={12} className="animate-spin" />}
          Save
        </button>
      </div>
      {error && <span className="text-[11px] text-danger-fg">{error}</span>}
      <p className="text-[11px] text-ink-faint">
        Granola → Settings → Workspaces → API → Generate API Key. Requires
        Granola Enterprise.
      </p>
    </form>
  )
}

/**
 * Run the Nango OAuth popup flow for an OAuth provider, then persist the
 * resulting connection ID to our DB.
 */
async function connectViaNango(provider: ConnectionProvider) {
  // Dynamic import so the @nangohq/frontend SDK doesn't ship in the SSR bundle.
  const NangoFrontend = (await import('@nangohq/frontend')).default

  const { token, providerKey } = await createNangoConnectSession(provider)
  const nango = new NangoFrontend({ connectSessionToken: token })

  const result = (await nango.auth(providerKey)) as {
    connectionId?: string
    connection_id?: string
  }
  const connectionId = result.connectionId ?? result.connection_id
  if (!connectionId) {
    throw new Error('Nango auth completed but did not return a connection ID.')
  }
  await recordNangoConnection(provider, connectionId)
}
