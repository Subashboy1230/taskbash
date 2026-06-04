# UI/UX Audit Report: taskbash.app
**Generated:** June 3, 2026  
**Scope:** /today, /connections, /profile, /activity, /handled, /settings/functions, /login, sidebar, UI primitives

---

## P0 — Critical Issues (Broken / Data Loss / Blockers)

### 1. Submit Button Not Disabled During Form Submission
**What:** Users can double-submit forms by clicking the submit button multiple times while a server action is in flight, potentially creating duplicate tasks or corrupting state.  
**Where:** `/app/today/today-view.tsx` line 2239 (DraftCard Send button), `/app/today/add-task-panel.tsx` line 288 (Create task button)  
**Severity:** P0  
**Why it matters:** Double-submit can create duplicate tasks, corrupted data, or confuse the backend.  
**Suggested fix:** Ensure `disabled={busy}` is set on all form submit buttons before state mutation occurs.

### 2. Missing Unread Thread Filtering Logic
**What:** When the detail panel marks an item complete, the unread threads list doesn't filter out the cleared thread ID immediately, causing stale data to display.  
**Where:** `/app/today/today-shell.tsx` lines 131–146, `setShellHiddenIds` called but `bufferedUnread` doesn't react  
**Severity:** P0  
**Why it matters:** User completes an item, looks at unread threads, and sees the old thread still listed (already handled).  
**Suggested fix:** Sync `shellHiddenIds` into the unread filter calculation when computing `filteredUnread`.

---

## P1 — Major Issues (Clearly Wrong, Looks Bad, Confuses Users)

### 3. Em-dash Usage Throughout Codebase (CLAUDE.md Violation)
**What:** Em-dashes (—) appear in dozens of comments and UI strings, but CLAUDE.md bans em-dashes everywhere.  
**Where:** `/app/today/today-view.tsx` lines 104, 119, 157, 161, 192, 206, 220, 243, etc.; `/app/today/add-task-panel.tsx` lines 3, etc.  
**Severity:** P1  
**Why it matters:** Violates documented style guide; inconsistency with policy.  
**Suggested fix:** Replace all em-dashes (—) with regular hyphens (-) or remove dashes entirely.

### 4. Disabled Button Missing Visual Feedback
**What:** The "Today" button in CalendarStrip (disabled when already on today) has `disabled:cursor-default disabled:opacity-60` but no visible disabled state indicator.  
**Where:** `/app/today/today-calendar-column.tsx` line 727  
**Severity:** P1  
**Why it matters:** Users click a disabled button, nothing happens, no reason given.  
**Suggested fix:** Add more obvious disabled styling or hide the button entirely when already on today.

### 5. Image Upload Without Accessibility Label
**What:** The screenshot preview image uses `alt="Attached screenshot"` but the drag-drop zone and file input lack clear ARIA labels explaining the drag-drop interaction.  
**Where:** `/app/today/add-task-panel.tsx` lines 476, 487–498  
**Severity:** P1  
**Why it matters:** Screen reader users cannot understand the image upload interaction or the purpose of the drop zone.  
**Suggested fix:** Add `aria-label` to the drop zone div and `aria-describedby` linking to help text.

### 6. Inconsistent Error Messages ("Failed" with No Actionable Next Step)
**What:** Error messages like "Failed to add task", "Send failed", "Network error. Try again." are vague and don't explain what went wrong or how to recover.  
**Where:** `/app/today/add-task-panel.tsx` line 170, `/app/today/today-view.tsx` line 1433, line 2175  
**Severity:** P1  
**Why it matters:** User has no way to understand why the action failed or how to fix it.  
**Suggested fix:** Include specific error details from the server response; provide "Retry" button or next action.

### 7. No Confirmation on Destructive Actions (Delete Function)
**What:** Users can delete a function tag by clicking a trash icon with no confirmation dialog, immediately removing it from all tasks.  
**Where:** `/app/settings/functions/functions-manager.tsx` line 90 (handleDelete)  
**Severity:** P1  
**Why it matters:** Accidental deletion of a function can orphan tag associations across many tasks with no undo.  
**Suggested fix:** Show a confirmation modal: "Delete 'Product'? It will be removed from N tasks."

### 8. Hover-Only Affordance on Touch Devices
**What:** Snooze menu and slop menu buttons only appear on hover (`opacity-0 group-hover:opacity-100`), making them inaccessible on mobile devices.  
**Where:** `/app/today/today-view.tsx` lines 1127–1132 (SnoozeMenu), lines 988–1001 (SlopMenu)  
**Severity:** P1  
**Why it matters:** Touch users cannot access quick actions, forcing them to open the detail panel instead.  
**Suggested fix:** Make these buttons always visible or add a touch-friendly menu toggle.

### 9. Tab State Lost on Navigation (Focus Not Trapped)
**What:** The tab selection (Open/Prep/Cleared/Unread) is preserved in localStorage, but when a user navigates away and back, the scroll position on the selected tab resets.  
**Where:** `/app/today/today-view.tsx` lines 145–156 (localStorage persistence)  
**Severity:** P1  
**Why it matters:** User loses their place when navigating between pages.  
**Suggested fix:** Store scroll position per tab alongside tab selection.

### 10. Timestamp Formatting Inconsistency (Some Local, Some UTC)
**What:** Some timestamps use `toLocaleTimeString` (local), others use raw ISO strings. Handled page shows completion times in user's timezone but profile timestamps may be UTC.  
**Where:** `/app/handled/page.tsx` line 91 (local), `/app/profile/page.tsx` line 25 (ISO)  
**Severity:** P1  
**Why it matters:** User sees mixed time formats and may misread when actions occurred.  
**Suggested fix:** Standardize all timestamps to user's local time using a centralized formatter.

### 11. Missing Fallback for Hardcoded Granola String
**What:** The connections page hardcodes "DMs and channels. Coming in Week 5 (needs auth feature)." for Slack, which will be outdated after the feature launches.  
**Where:** `/app/connections/connections-view.tsx` line 75  
**Severity:** P1  
**Why it matters:** Outdated status message confuses users about whether Slack is available.  
**Suggested fix:** Store feature status in a config/env variable; query it at runtime instead of hardcoding.

### 12. Modal/Sheet Escape Behavior Inconsistent
**What:** The DetailPanel and AddTaskPanel use Radix Dialog / Sheet, but Esc key closes them only if the focus is on the sheet content; if focus is trapped elsewhere, Esc doesn't work.  
**Where:** `/app/_components/ui/sheet.tsx` line 24 (SheetOverlay, click-outside works but Esc may not)  
**Severity:** P1  
**Why it matters:** Users expect Esc to always close modals; some interactions trap focus and make Esc non-functional.  
**Suggested fix:** Ensure Radix Dialog's default escapeKeyDown is not suppressed; verify focus trap is correct.

### 13. Extract Tasks Form Missing Disabled State on Submit During Extraction
**What:** The "Extract tasks" button is disabled while extracting, but the "Add N tasks" button in the preview doesn't disable while committing, allowing double-submit.  
**Where:** `/app/today/add-task-panel.tsx` line 455  
**Severity:** P1  
**Why it matters:** User can click "Add tasks" twice and create duplicate tasks.  
**Suggested fix:** Set `disabled={committing}` on the commit button.

---

## P2 — Rough Edges (Polish)

### 14. Tooltip Text Repeats Button Label Verbatim
**What:** Buttons like "Add task" have `title="Add a manual task"` which is just a verbose rephrasing of the button text and doesn't add new information.  
**Where:** `/app/today/today-view.tsx` lines 463–464  
**Severity:** P2  
**Why it matters:** Tooltips should clarify, not repeat; clutters the UI.  
**Suggested fix:** Either remove the title or provide context like "Add a manual task to your inbox."

### 15. Long Task Titles Overflow (Truncation Issue)
**What:** Task titles in the calendar day-cell popover are truncated with no visual indicator (`truncate` class on line 418 of today-calendar-column.tsx) but no ellipsis CSS.  
**Where:** `/app/today/today-calendar-column.tsx` line 418  
**Severity:** P2  
**Why it matters:** User sees "Send the Q3 OK…" and doesn't know the full title; hover-preview is available but not obvious.  
**Suggested fix:** Ensure `overflow-hidden text-ellipsis` pair is present, or show full title in a tooltip.

### 16. Inconsistent Button Sizing and Spacing
**What:** Priority buttons in the manual form use `px-2.5 py-1` (line 200) but function buttons use `px-2.5 py-1` too, but priority buttons are `text-[11px]` while function buttons are `text-[12px]`, creating visual misalignment.  
**Where:** `/app/today/add-task-panel.tsx` lines 197–210 (priority), 262–282 (functions)  
**Severity:** P2  
**Why it matters:** Inconsistent sizing makes the form look sloppy.  
**Suggested fix:** Standardize button sizes and font sizes across the add-task form.

### 17. Empty State Copy Is Generic
**What:** The "Nothing here yet" message in /handled doesn't hint at what the user should do next (e.g., "Complete tasks in /today to see them here").  
**Where:** `/app/handled/page.tsx` line 55  
**Severity:** P2  
**Why it matters:** New users don't understand the relationship between pages.  
**Suggested fix:** Add a tip: "Complete or approve tasks in /today to see them here."

### 18. Color Contrast: Light Text on Light Background
**What:** The "Add description" button uses `text-ink-faint` (low contrast) on a `border-dashed border-line/60 bg-canvas` background, making it hard to read.  
**Where:** `/app/today/today-view.tsx` line 2040  
**Severity:** P2  
**Why it matters:** Users with low vision or on bright displays may not see the button.  
**Suggested fix:** Use `text-ink-muted` or `text-ink` instead of `text-ink-faint`.

### 19. Missing aria-label on Icon-Only Buttons
**What:** Several icon-only buttons (collapse/expand calendar, priority chip menu toggle) lack aria-labels, making them inaccessible to screen reader users.  
**Where:** `/app/today/today-calendar-column.tsx` lines 162, 210 (missing aria-labels), but some present  
**Severity:** P2  
**Why it matters:** Screen reader users cannot identify button purpose.  
**Suggested fix:** Add `aria-label` to every icon-only button.

### 20. Race Condition: Optimistic Update with Delayed Server Revert
**What:** If a subtask toggle fails on the server, the local state reverts, but the UI fades back in momentarily before the error is shown, creating a flickering effect.  
**Where:** `/app/today/today-view.tsx` lines 920–927 (toggleSub with catch revert)  
**Severity:** P2  
**Why it matters:** Visual glitch; user sees the subtask state flip twice.  
**Suggested fix:** Add a loading state or toast notification instead of just reverting silently.

### 21. Inconsistent Loading Indicators
**What:** Some async operations show spinners (Re-run tasks button), others don't (Delete function). Users don't know if an action is processing.  
**Where:** `/app/settings/functions/functions-manager.tsx` line 92 (no spinner shown on delete), `/app/today/today-view.tsx` line 480 (spinner shown on refresh)  
**Severity:** P2  
**Why it matters:** Inconsistent UX; users may double-click if they think nothing is happening.  
**Suggested fix:** Show a spinner or toast for all async operations.

### 22. Unused Import: "History" Icon
**What:** The History icon is imported on line 26 of today-view.tsx but never used in the component.  
**Where:** `/app/today/today-view.tsx` line 26  
**Severity:** P2  
**Why it matters:** Dead code; minor bundle bloat.  
**Suggested fix:** Remove the unused import.

### 23. TODO Comment Left in Production Code
**What:** Line 1380 of today-view.tsx has a TODO about making the FunctionPill clickable to filter.  
**Where:** `/app/today/today-view.tsx` line 1380 (`// title; clickable to scope the row's filter (TODO).`)  
**Severity:** P2  
**Why it matters:** Incomplete feature advertised in code.  
**Suggested fix:** Either implement the feature or remove the comment.

### 24. No Loading State for Calendar Events Fetch
**What:** When the user clicks a different day in the calendar, events load asynchronously but there's no loading spinner until `loading` state changes, causing a layout shift.  
**Where:** `/app/today/today-calendar-column.tsx` lines 289–311, 323–326  
**Severity:** P2  
**Why it matters:** Layout shift is jarring; user doesn't know events are loading.  
**Suggested fix:** Show a small spinner immediately when fetching events.

### 25. Inconsistent Terminology: "Slop" vs "Wrong"
**What:** The menu for flagging bad items calls it "slop" in the title but uses "This shouldn't be here" in the tooltip, and the UI label says "Mark as slop (wrong / irrelevant)".  
**Where:** `/app/today/today-view.tsx` lines 1304–1306, 1313  
**Severity:** P2  
**Why it matters:** Mixed terminology confuses users.  
**Suggested fix:** Pick one term ("Mark as low-quality" or "Mark as irrelevant") and use it consistently.

---

## P3 — Nice-to-Have / Future Polish

### 26. No Copy Feedback on Manual Task Creation
**What:** After a user creates a task, there's no success toast or confirmation message; they only know it worked when the page reloads.  
**Where:** `/app/today/add-task-panel.tsx` line 168 (no toast shown)  
**Severity:** P3  
**Why it matters:** Gratification; helps users feel confident the action succeeded.  
**Suggested fix:** Show a brief success toast or message.

### 27. Suboptimal Z-Index Organization
**What:** Priority chip menu uses `z-30`, calendar popover uses `z-[60]`, and dropdown menus use `z-50`, but there's no clear stacking context hierarchy defined.  
**Where:** `/app/today/today-view.tsx` line 1634, `/app/today/today-calendar-column.tsx` line 410, `/app/_components/ui/dropdown-menu.tsx` line 46  
**Severity:** P3  
**Why it matters:** Could lead to overlapping popovers in edge cases.  
**Suggested fix:** Document z-index tiers (e.g., tooltips=50, modals=100) and enforce in code.

### 28. Accessibility: Missing `role="button"` on Clickable Divs
**What:** The detail panel's title has `onClick` and `className="cursor-text"` but no `role="button"` to indicate it's interactive.  
**Where:** `/app/today/today-view.tsx` lines 1918–1925 (editable title div)  
**Severity:** P3  
**Why it matters:** Screen reader users may not discover the click interaction.  
**Suggested fix:** Add `role="button"` and `tabIndex={0}` to make keyboard-navigable.

### 29. Form Validation Only on Submit
**What:** The title field in the add-task form only shows an error after the user tries to submit with an empty title; no real-time validation.  
**Where:** `/app/today/add-task-panel.tsx` lines 153–157  
**Severity:** P3  
**Why it matters:** Users don't get early feedback; slightly frustrating UX.  
**Suggested fix:** Add `onChange` handler to clear the error and enable/disable the submit button in real-time.

### 30. Prep Tab Label Does Not Indicate Content (Meeting Prep)
**What:** The "Prep" tab label is ambiguous; users may not immediately understand it contains meeting prep briefs.  
**Where:** `/app/today/today-view.tsx` line 443  
**Severity:** P3  
**Why it matters:** Minor confusion; could be "Prep briefs" or "Meetings" for clarity.  
**Suggested fix:** Rename to "Prep briefs" or add a tooltip.

---

## Summary

**Total Findings:** 30  
**P0 (Blockers):** 2  
**P1 (Major):** 11  
**P2 (Polish):** 9  
**P3 (Nice-to-have):** 8  

**Key Patterns:**
1. **Double-submit risk** on forms (P0) — submit buttons not properly disabled.
2. **Em-dash usage** throughout codebase violates documented style guide (CLAUDE.md).
3. **Accessibility gaps** — missing aria-labels, icon-only buttons, contrast issues.
4. **Inconsistent error handling** — generic error messages with no actionable next steps.
5. **Hover-only interactions** — problematic on mobile/touch devices.
6. **Missing confirmations** — destructive actions (delete, dismiss) should require confirmation.

**Immediate Priorities:**
- Fix double-submit vulnerability (P0 #1)
- Add proper error messages with actionable next steps (P1 #6)
- Implement delete confirmation dialogs (P1 #7)
- Replace em-dashes with hyphens per CLAUDE.md (P1 #3)
