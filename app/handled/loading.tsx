export default function HandledLoading() {
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
          <div className="skeleton mb-1 h-8 w-2/3 max-w-[420px]" />
          <div className="skeleton h-4 w-1/3 max-w-[260px]" />
          <div className="mt-8 space-y-8">
            {Array.from({ length: 3 }).map((_, d) => (
              <section key={d}>
                <div className="skeleton mb-3 h-4 w-24" />
                <ul className="list-none p-0 m-0 divide-y divide-line/50 stagger">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <li key={i} className="flex items-start justify-between gap-4 px-2 py-3.5 animate-fade-in-up">
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="skeleton h-4 w-3/4" />
                        <div className="skeleton h-3 w-1/2" />
                      </div>
                      <div className="skeleton h-5 w-20 rounded-full" />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}
