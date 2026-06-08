# Claude Code prompts for the 4 QA bugs I couldn't fully fix from static code

Branch `qa-fixes-2026-06-08` already ships:

- B2 — stuck Inngest run status (try/catch around digest body)
- B3 — HTML entity decode in subtitles (lib/text.ts + 3 render sites)
- B4 — /settings/whatsapp wrapped in PageShell
- B6 — slop-rate chart empty-state covers all-zero data
- B9 — Slack "Coming in Week 5" copy removed
- B1 (partial) — suppressHydrationWarning on 2 of the obvious time-render spots

These 4 bugs need either runtime debugging, deliberate repro, or wider refactor than is safe from static analysis. Paste each prompt into Claude Code in sequence.

---

## Prompt 1 — Track down the root cause of React #418 (hydration) site-wide

```
React error #418 (hydration mismatch — "text" arg) fires on every page in production: /today, /activity, /observability at minimum. I already added suppressHydrationWarning to two obvious time-render spots (today-view.tsx headlineDate span and recent-calls-table.tsx time td) but #418 keeps firing.

Find the remaining source(s) of the hydration mismatch and fix them properly (not with more suppress flags).

Likely suspects already identified, ranked by traffic:
1. app/today/today-calendar-column.tsx — classifyEvents() at line 437 uses Date.now() in a render path. The author already guards with useState initialized to all-'future' and reclassifies in useEffect, but check if the sort at lines 481-486 produces different DOM order between server and first client render.
2. app/today/today-view.tsx:3004 — `const _nowMs = nowMs ?? Date.now()` fallback. Trace every caller; ensure the server-provided nowFromServer prop flows through to every Date.now() consumer.
3. app/today/today-view.tsx:818-826 — headlineDate uses toLocaleDateString on todayDate. todayDate at line 773 is `new Date(todayY, todayM-1, todayD)` — confirm todayY/M/D come from the server prop, not a fresh Date().
4. Any usage of `new Date()` (no args) or `Date.now()` inside a JSX render path in any 'use client' component.

For each one, do NOT add more suppressHydrationWarning. Instead:
- If it's a client-only render, defer it with useEffect/useState (initial state = ''  or a placeholder; useEffect sets the real value after mount).
- If it's deterministic given a server-passed prop, make sure every code path passes that prop down. No silent Date.now() fallbacks.

Use grep for: `Date\.now\(\)`, `new Date\(\)`, `toLocaleString`, `toLocaleDateString`, `toLocaleTimeString` across app/. Skip server components (no "use client" at top).

After your fixes: hit /today, /activity, /observability in the browser, watch DevTools console. Zero #418 errors should fire on any of them.

Acceptance: no React #418 errors in console on any page in production mode. tsc --noEmit && npm run build clean.
```

---

## Prompt 2 — Reproduce and fix the /today tab-count swap (Prep ↔ Cleared)

```
On https://taskbash.app/today the Prep and Cleared tab counts appear to swap when the user clicks a task that lives in a different tab. I observed:

  - First page load: `Open 126 · Prep 11 · Cleared 6 · Unread 17`
  - After clicking a Prep-class task row near the top: `Open 126 · Prep 6 · Cleared 11 · Unread 17`

Prep and Cleared exactly swapped values. Could be a real reclassification (the click triggered something), OR a label/value swap in the tab-count fetch.

Steps:
1. Reproduce deliberately. Open /today in your dev browser, capture the four tab counts, click a Prep-tab task that opens the detail panel, re-capture counts.
2. If counts changed: instrument the tab-count fetch (server action or API route that loads Open/Prep/Cleared/Unread counts). Log which segment each count maps to.
3. Find the swap. Most likely either (a) the four counts are pulled in a map/reduce that overwrites prep with cleared via a key collision, OR (b) the optimistic update on click-clear writes to the wrong segment.
4. Fix and verify by re-running step 1 — counts should remain stable across detail-panel clicks unless a real status change happens.

If you cannot reproduce in 5 minutes, document what you tried and stop. Don't blind-patch.

Acceptance: tab counts stay stable across detail-panel open/close. Only change when a real task action (complete/dismiss/snooze) flips a row's tab membership.
```

---

## Prompt 3 — Verify and fix /activity right-panel "No events scheduled today"

```
On https://taskbash.app/activity the right calendar panel shows "No events scheduled today" while every other page wrapped in PageShell shows today's events correctly. /handled, /observability, /connections, /profile, /network, /settings/* all render the events fine using the same loadTodayEvents() helper.

The likely cause is the silent .catch(() => []) pattern on app/activity/page.tsx:29:
  loadTodayEvents().catch(() => []),

If loadTodayEvents() throws intermittently for any reason (timeout, transient Supabase blip), the empty array gets passed to PageShell and the calendar panel correctly renders the "no events" state — but the user has no idea anything failed.

Steps:
1. Reproduce: visit /activity, confirm "No events scheduled today" appears. Visit /handled, confirm events appear.
2. Add a console.error inside the .catch on app/activity/page.tsx:29 so you can see if the fetch is actually erroring vs. genuinely returning empty.
3. If it's erroring: figure out why /activity's fetch fails when other pages' do not. Suspect: the Promise.all on /activity loads 9 things including 6 user-id-specific loaders. If any of those bloat the connection pool or trip a rate limit, loadTodayEvents may share the same DB connection and time out.
4. The right fix is the same as polish-tickets.md Ticket 5 — replace the silent swallow with a real surface. For events specifically, an empty events array should render distinctly from a failed fetch ("Couldn't load events — Retry" vs. "No events scheduled today").

Acceptance: /activity shows the same events as /handled at any moment. If the fetch fails, the user sees an error, not a misleading empty state.
```

---

## Prompt 4 — Investigate low-contrast first task on /today Prep tab

```
On https://taskbash.app/today's Prep tab, the FIRST task row's expanded body (description text + subtasks list) renders at very low contrast — barely readable against the dark background. The rest of the tasks below render normally.

Steps:
1. Reproduce: open /today, click Prep tab, look at the first row. Confirm body + subtasks are washed out vs. the rows below.
2. Inspect the DOM. Look for an opacity-50, text-muted-foreground, or similar utility class applied only to the top row. Possible sources:
   - "stale" or "loading" state class that should only apply during a transition
   - First-row hover/focus state stuck on
   - Animation that never completes (initial opacity-0 → opacity-100 transition that fails)
3. If the styling is intentional (e.g., signaling "this task is being processed"), document why and downgrade the QA finding. Otherwise restore standard contrast.

Acceptance: all task rows on the Prep tab render at the same readable contrast. No row is unintentionally grayed out.
```

---

## Workflow note

Each prompt is self-contained. Paste one at a time into Claude Code (the same chat session is fine), let it work, review the diff, commit. The first two are P0/P1 and worth doing now. Prompts 3 and 4 can wait until polish-tickets.md Ticket 5 ships, since they share the same fix surface.
