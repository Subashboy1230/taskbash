// Pure client-safe utility for picking a chip color for a function.
// Lives in its own file (separate from load-functions.ts which uses
// next/headers via supabase-server) so 'use client' components can
// import it without Next refusing to bundle the chain.

const FALLBACK_COLORS = [
  '#7B68EE', // purple
  '#1D9E75', // teal
  '#D85A30', // coral
  '#0C447C', // blue
  '#993556', // pink
  '#854F0B', // amber
  '#3B6D11', // green
  '#A32D2D', // red
] as const

/**
 * Deterministic chip color when a function has no explicit color set.
 * Hashes the function id to one of 8 preset hues so the same function
 * always renders the same color across sessions.
 */
export function functionColor(fn: { id: string; color: string | null }): string {
  if (fn.color) return fn.color
  let h = 0
  for (let i = 0; i < fn.id.length; i++) h = (h * 31 + fn.id.charCodeAt(i)) >>> 0
  return FALLBACK_COLORS[h % FALLBACK_COLORS.length]
}
