export default function ProfileLoading() {
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
          <div className="skeleton mb-6 h-8 w-1/4 max-w-[200px]" />
          <div className="flex gap-2 mb-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skeleton h-8 w-24 rounded-md" />
            ))}
          </div>
          <div className="space-y-4 stagger">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-lg border border-line/60 bg-surface p-4 animate-fade-in-up">
                <div className="skeleton h-5 w-1/3 mb-2" />
                <div className="skeleton h-4 w-2/3" />
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}
