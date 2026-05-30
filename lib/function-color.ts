// Pure client-safe utility for picking a chip color for a function.
// Lives in its own file (separate from load-functions.ts which uses
// next/headers via supabase-server) so 'use client' components can
// import it without Next refusing to bundle the chain.

// Dark-mode brightened palette — the previous mid-saturation hues read
// as muddy on a near-black canvas. These are picked to stay legible at
// 12px on #0a0a0a while keeping the families visually distinct.
// Dark-mode brightened palette with maximum hue separation so adjacent
// chips never read as the same family on near-black. Reordered to put
// the two most-distinct hues (yellow + cyan) early so two functions in
// a row get visually different chips.
const FALLBACK_COLORS = [
  '#f472b6', // pink
  '#5eead4', // teal/cyan
  '#fcd34d', // amber/yellow
  '#a78bfa', // purple
  '#60a5fa', // blue
  '#fb923c', // coral/orange
  '#86efac', // green
  '#fca5a5', // red
] as const

// Name-based overrides: if a function's NAME matches a known label we
// pick a hand-tuned color instead of hashing the id. Lets the canonical
// roster (Product / Ops / QA / Hiring / GTM / Marketing) read with
// consistent identity colors across users while still falling back to
// the hash for user-defined names.
const NAME_OVERRIDES: Record<string, string> = {
  product: '#f472b6',          // pink
  'product management': '#f472b6',
  ops: '#5eead4',              // cyan (was muddy purple before)
  'people ops': '#5eead4',
  qa: '#fcd34d',               // amber (was muddy purple — now distinct from Ops)
  hiring: '#60a5fa',           // blue
  gtm: '#fb923c',              // coral
  'go-to-market': '#fb923c',
  marketing: '#fb923c',
  engineering: '#a78bfa',      // purple
  design: '#86efac',           // green
  finance: '#fca5a5',          // red
}

/**
 * Deterministic chip color when a function has no explicit color set.
 * Resolution order:
 *   1. fn.color (user picked one in /settings/functions)
 *   2. NAME_OVERRIDES (canonical roster gets stable identity colors)
 *   3. Hash of fn.id into FALLBACK_COLORS
 */
export function functionColor(fn: {
  id: string
  name?: string
  color: string | null
}): string {
  if (fn.color) return fn.color
  if (fn.name) {
    const override = NAME_OVERRIDES[fn.name.trim().toLowerCase()]
    if (override) return override
  }
  let h = 0
  for (let i = 0; i < fn.id.length; i++) h = (h * 31 + fn.id.charCodeAt(i)) >>> 0
  return FALLBACK_COLORS[h % FALLBACK_COLORS.length]
}
