export default function ActivityLoading() {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-canvas">
      <aside className="sticky top-0 hidden h-screen w-[180px] shrink-0 flex-col border-r border-line bg-canvas px-4 pt-5 md:flex">
        <div className="skeleton mb-8 h-7 w-24" />
        <div className="space-y-1.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="skeleton h-7 w-full rounded-md" />
          ))}
        </div>
      </aside>
      <main className="flex-1 min-w-0 px-8 pt-6 pb-16 overflow-y-auto">
        <div className="mx-auto max-w-[920px]">
          <div className="skeleton mb-1 h-8 w-1/4 max-w-[200px]" />
          <div className="skeleton h-4 w-2/3 max-w-[420px]" />
          <div className="mt-6 flex gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="skeleton h-7 w-20 rounded-md" />
            ))}
          </div>
          <ul className="mt-6 list-none p-0 m-0 divide-y divide-line/50 stagger">
            {Array.from({ length: 8 }).map((_, i) => (
              <li key={i} className="flex items-center gap-3 py-3 animate-fade-in-up">
                <div className="skeleton size-8 rounded-md" />
                <div className="flex-1 space-y-2">
                  <div className="skeleton h-4 w-2/3" />
                  <div className="skeleton h-3 w-1/3" />
                </div>
                <div className="skeleton h-3 w-16" />
              </li>
            ))}
          </ul>
        </div>
      </main>
    </div>
  )
}
