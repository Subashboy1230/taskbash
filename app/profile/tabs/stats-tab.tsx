'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/app/_components/ui/card'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'

type SlopPoint = { date: string; source: string; slopPct: number }

interface Props {
  stats: {
    clearedToday: number
    clearedWeek: number
    clearedMonth: number
    slopTimeSeries: SlopPoint[]
    topFunction: { name: string; count: number; pct: number } | null
  }
}

const SOURCE_COLORS: Record<string, string> = {
  gmail: '#60a5fa',
  granola: '#a78bfa',
  linear: '#f472b6',
  calendar: '#34d399',
  slack: '#fb923c',
  manual: '#a3a3a3',
}

export default function StatsTab({ stats }: Props) {
  const chartData = buildChartData(stats.slopTimeSeries)
  const sources = Array.from(new Set(stats.slopTimeSeries.map(p => p.source)))

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Cleared today" value={stats.clearedToday} />
        <StatCard label="Cleared this week" value={stats.clearedWeek} />
        <StatCard label="Cleared this month" value={stats.clearedMonth} />
      </div>

      {stats.topFunction && (
        <Card className="bg-surface border-line">
          <CardContent className="pt-5 pb-4 px-5">
            <p className="m-0 text-[11px] text-ink-faint uppercase tracking-wider font-semibold mb-1.5">
              Top function this week
            </p>
            <p className="m-0 text-[18px] font-semibold text-ink">{stats.topFunction.name}</p>
            <p className="m-0 mt-0.5 text-[12px] text-ink-muted">
              {stats.topFunction.count} tasks ({stats.topFunction.pct}% of total)
            </p>
          </CardContent>
        </Card>
      )}

      <Card className="bg-surface border-line">
        <CardHeader className="pb-2 pt-5 px-5">
          <CardTitle className="text-[13px] font-semibold text-ink-muted">
            Slop rate by source (last 30 days)
          </CardTitle>
        </CardHeader>
        <CardContent className="px-2 pb-4 pt-0">
          {chartData.length === 0 ? (
            <p className="text-[13px] text-ink-faint text-center py-8">
              No slop data yet. Mark tasks as incorrect to start tracking.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chartData} margin={{ top: 4, right: 16, left: -16, bottom: 0 }}>
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: '#6b6b6b' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={d => d.slice(5)}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: '#6b6b6b' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={v => `${v}%`}
                  domain={[0, 100]}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#141414',
                    border: '1px solid #262626',
                    borderRadius: 6,
                    fontSize: 11,
                    color: '#fafafa',
                  }}
                  labelStyle={{ color: '#a3a3a3', marginBottom: 4 }}
                  formatter={(value) => [`${value}%`]}
                />
                <Legend
                  iconSize={8}
                  wrapperStyle={{ fontSize: 11, color: '#a3a3a3', paddingTop: 8 }}
                />
                {sources.map(src => (
                  <Line
                    key={src}
                    type="monotone"
                    dataKey={src}
                    stroke={SOURCE_COLORS[src] ?? '#a3a3a3'}
                    dot={false}
                    strokeWidth={1.5}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card className="bg-surface border-line">
      <CardContent className="pt-5 pb-4 px-5">
        <p className="m-0 text-[24px] font-semibold text-ink">{value}</p>
        <p className="m-0 mt-0.5 text-[12px] text-ink-faint">{label}</p>
      </CardContent>
    </Card>
  )
}

function buildChartData(points: SlopPoint[]): Record<string, string | number>[] {
  const byDate: Record<string, Record<string, number>> = {}
  for (const p of points) {
    byDate[p.date] ??= {}
    byDate[p.date][p.source] = p.slopPct
  }
  return Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, vals]) => ({ date, ...vals }))
}
