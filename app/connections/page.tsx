// /connections — manage your OAuth + API-key sources.
// Server component: loads current connections from the DB and hands them to
// the client component that owns the button interactions.

import {
  listUserConnections,
  syncOAuthConnectionsFromNango,
} from '@/lib/connections'
import { ConnectionsView } from './connections-view'

export const dynamic = 'force-dynamic'

export default async function ConnectionsPage() {
  // Pull any freshly-completed OAuth connections down from Nango before
  // rendering — robust against the frontend SDK's popup→postMessage glitches.
  await syncOAuthConnectionsFromNango()
  const connections = await listUserConnections()
  return <ConnectionsView connections={connections} />
}
