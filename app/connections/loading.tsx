export default function ConnectionsLoading() {
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
          <div className="skeleton mb-2 h-4 w-28" />
          <div className="skeleton mb-1 h-8 w-1/3 max-w-[280px]" />
          <div className="skeleton h-4 w-2/3 max-w-[420px]" />
          <div className="mt-8 grid grid-cols-1 gap-3 md:grid-cols-2 stagger">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="rounded-lg border border-line/60 bg-surface p-4 animate-fade-in-up">
                <div className="flex items-start gap-3">
                  <div className="skeleton size-11 rounded-lg" />
                  <div className="flex-1 space-y-2">
                    <div className="skeleton h-5 w-1/2" />
                    <div className="skeleton h-3 w-3/4" />
                  </div>
                </div>
                <div className="mt-4 flex justify-end">
                  <div className="skeleton h-7 w-20 rounded-md" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}
