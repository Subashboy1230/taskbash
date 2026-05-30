// Pure client-safe utility for picking a chip color for a function.
// Lives in its own file (separate from load-functions.ts which uses
// next/headers via supabase-server) so 'use client' components can
// import it without Next refusing to bundle the chain.

// Dark-mode brightened palette — the previous mid-saturation hues read
// as muddy on a near-black canvas. These are picked to stay legible at
// 12px on #0a0a0a while keeping the families visually distinct.
const FALLBACK_COLORS = [
  '#a78bfa', // purple
  '#5eead4', // teal
  '#fb923c', // coral
  '#60a5fa', // blue
  '#f472b6', // pink
  '#fcd34d', // amber
  '#86efac', // green
  '#fca5a5', // red
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
