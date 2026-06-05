// Skeleton placeholder shown while /today's data loads.
// Mirrors the rough shape of the real layout: sidebar + main + right column.

export default function TodayLoading() {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-canvas">
      {/* Sidebar skeleton */}
      <aside className="sticky top-0 hidden h-screen w-[180px] shrink-0 flex-col border-r border-line bg-canvas px-4 pt-5 md:flex">
        <div className="mb-8 flex items-center gap-2">
          <div className="skeleton size-7" />
          <div className="skeleton h-4 w-20" />
        </div>
        <div className="space-y-1.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="skeleton h-7 w-full rounded-md" />
          ))}
        </div>
      </aside>

      {/* Main column skeleton */}
      <main className="flex-1 min-w-0 px-8 pt-6 pb-16 overflow-y-auto">
        <div className="skeleton mb-2 h-8 w-2/3 max-w-[420px]" />
        <div className="skeleton h-4 w-1/3 max-w-[260px]" />

        {/* Tabs */}
        <div className="mt-6 flex gap-1">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-8 w-20 rounded-md" />
          ))}
        </div>

        {/* Filter bar */}
        <div className="mt-4 flex gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-7 w-24 rounded-full" />
          ))}
        </div>

        {/* Task rows */}
        <ul className="mt-6 list-none p-0 m-0 stagger">
          {Array.from({ length: 6 }).map((_, i) => (
            <li
              key={i}
              className="flex items-start gap-3 pl-12 pr-2 py-4 border-b border-line/50 animate-fade-in-up"
            >
              <div className="absolute left-3 top-4 size-5 skeleton rounded-md" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="skeleton h-4 w-2/3 max-w-[480px]" />
                <div className="skeleton h-3 w-1/2 max-w-[360px]" />
              </div>
              <div className="skeleton size-6 rounded-md" />
            </li>
          ))}
        </ul>
      </main>

      {/* Right column skeleton (calendar) */}
      <aside className="sticky top-0 hidden h-screen w-[300px] shrink-0 border-l border-line bg-canvas px-5 py-6 lg:block">
        <div className="skeleton mb-3 h-5 w-32" />
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: 35 }).map((_, i) => (
            <div key={i} className="skeleton size-7 rounded-full" />
          ))}
        </div>
        <div className="mt-6 space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-12 w-full rounded-md" />
          ))}
        </div>
      </aside>
    </div>
  )
}
