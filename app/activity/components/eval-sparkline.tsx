export function EvalSparkline({ values, className }: { values: number[]; className?: string }) {
  if (values.length === 0) return null
  const max = 100
  const min = Math.min(...values, 0)
  const range = max - min || 1
  const w = 80
  const h = 16
  const step = w / Math.max(values.length - 1, 1)
  const points = values
    .map((v, i) => `${i * step},${h - ((v - min) / range) * h}`)
    .join(' ')
  return (
    <svg width={w} height={h} className={`inline-block ${className ?? ''}`}>
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        points={points}
      />
    </svg>
  )
}
