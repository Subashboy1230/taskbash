# Polish pass — taskbash, post-audit

Production hardening, **post-audit version**. The first draft of this doc made several incorrect claims about taskbash's current state. This version reflects the actual state of the codebase as audited on 2026-06-04 (branch: dev).

## Audit summary

| # | Area | State | One-line |
|---|------|-------|----------|
| 1 | Error boundaries | Partial | `app/today/error.tsx` exists; root + 8 other routes unprotected; panel/popover unwrapped |
| 2 | Loading / error / empty | Mostly there | Every route has `loading.tsx`; real gap is silent `.catch(()=>[])` swallows hiding load failures |
| 3 | Resilient forms | Partial | Only the snooze trigger is the real bug; Add-task and Send-Gmail are already protected; zod installed but unused |
| 4 | Sentry / error tracking | **Missing** | Nothing installed. Highest production risk — unhandled exceptions are invisible |
| 5 | 404 + broken images | **Missing** | No `app/not-found.tsx`; 6 raw `<img>` with no fallback (brand logos, sidebar wordmark, login) |

## Recommended fix order (by risk)

1. **Sentry** — only "blind in prod" gap. Do this first.
2. **Error boundaries** — root + per-route + panel/popover wraps.
3. **Snooze pending-guard** — confirmed live bug, 10 min fix.
4. **404 page + SafeImage** — self-contained, ~30 min.
5. **Silent `.catch` swallows** — surface load failures.

---

## Workflow per prompt

```
git checkout -b polish/N-shortname
# paste the prompt into Claude Code or Cursor
# let it run
# review diff
git add . && git commit -m "polish: <what>"
git push
```

If any prompt goes off-script, abandon the branch (`git checkout dev && git branch -D polish/N-shortname`) and re-prompt with tighter constraints.

---

## 1. Sentry (do this first)

```
Set up Sentry for this Next.js 16 App Router project.

1. Run: npx @sentry/wizard@latest -i nextjs --saas
   When prompted, create a new Sentry project called "taskbash" if one does not exist. Use the org/team I am logged into.

2. Verify it creates sentry.server.config.ts, sentry.client.config.ts, sentry.edge.config.ts, and wraps next.config.js with withSentryConfig.

3. Add Sentry to every Inngest function in inngest/functions/ — every step.run body wrapped in try/catch, Sentry.captureException on error. Cover gmail-poll (every 5 min), the digest jobs, and all whatsapp-* functions.

4. Add a try/catch around middleware.ts:39-56 (auth.getUser call) and capture exceptions there.

5. Add user context tagging: in lib/auth/server.ts (or wherever the user session loads server-side), call Sentry.setUser({ id: userId, email }) once per authenticated request.

6. Create app/sentry-test/page.tsx that throws on render. I will hit /sentry-test once to confirm errors flow into the dashboard, then you delete the page.

7. Add SENTRY_DSN, SENTRY_ORG, SENTRY_PROJECT, SENTRY_AUTH_TOKEN to .env.example with placeholder comments.

8. Print the exact list of env-var names and values I need to paste into Vercel for production.

Do NOT enable Sentry session replay or performance monitoring tracesSampleRate. Error-only free tier.
```

Why: zero error tracking today. Langfuse covers LLM traces only. Inngest retries silently. The first sign of a production bug is a user DM you might not get.

---

## 2. Error boundaries

```
Add error boundaries to this Next.js App Router app. app/(app)/today/error.tsx already exists — do not touch it. Add the rest:

1. Create app/error.tsx (Client Component) — root boundary with friendly message + Try again button calling reset(). Wrap content in shadcn Card using existing dark palette tokens.

2. Create app/global-error.tsx for catastrophic failures. Must render its own <html><body> tags.

3. Create per-route error.tsx (Client Components) for the 8 unprotected routes:
   - app/(app)/handled/error.tsx
   - app/(app)/connections/error.tsx
   - app/(app)/activity/error.tsx
   - app/(app)/observability/error.tsx
   - app/(app)/network/error.tsx
   - app/(app)/settings/whatsapp/error.tsx
   - app/(app)/settings/functions/error.tsx
   - app/(app)/profile/error.tsx
   Each shows the error message + Try again + link to /today.

4. Install react-error-boundary. Wrap the Sheet detail panel body (today-shell.tsx:244-281) and the calendar popover body (today-calendar-column.tsx:410-430) in ErrorBoundary components with small inline fallbacks (single line of text, no big card).

No em-dashes in any string. No raw Tailwind colors. List every file created.
```

Why: any throw in TaskCard, the calendar popover, or the Sheet detail panel currently blanks /today. With these, only the broken component blanks — layout, sidebar, calendar stay alive.

---

## 3. Snooze pending-guard (small fix)

```
The snooze picker trigger at today-view.tsx:1329 has no `disabled={isPending}` guard, so double-clicking re-fires the snooze action twice. Fix it:

1. Find the snooze trigger at today-view.tsx:1329.
2. Add disabled={isPending} to the trigger (the same pattern used elsewhere — see the Send Gmail Draft button at today-view.tsx:2343-2370 for reference).
3. While you are there, audit the other forms confirmed to have no pending guard: edit-mode inline inputs in today-view.tsx, WhatsApp form fields in app/(app)/settings/whatsapp/, and the Reject Draft button. Add disabled={isPending} to each.

Do NOT touch Add-task or Send-Gmail — both already have correct pending guards.

Bonus: zod ^3.23.8 is installed but imported nowhere. If you have spare time, add inline field validation to the Add-task input using zod (the schema can live in lib/validation/task.ts). Otherwise leave zod alone — it is not blocking anything.
```

Why: confirmed live bug, small surface area, easy win.

---

## 4. 404 page + SafeImage

```
1. Create app/not-found.tsx with a friendly "Page not found" message, the taskbash logo, and a primary button back to /today. Use the existing Card + dark palette + spacing tokens.

2. Skip the notFound() audit — taskbash has zero dynamic [slug]/[id] routes, so there is nothing to gate. (This was incorrectly listed in the earlier draft of this doc.)

3. Create components/ui/safe-image.tsx — a thin wrapper around <img> that accepts a `fallback` prop. On onError, swap the src to the fallback. Default fallback: a neutral gray placeholder div.

4. Replace 6 raw <img> usages with SafeImage:
   - 4 brand logos in components/brand-logo.tsx:18-30 (used on /connections)
   - sidebar wordmark in components/app-sidebar.tsx:84
   - login logo (find it under app/login/ or similar)
   For each, pass a sensible fallback (e.g., for brand logos, use an SVG monogram; for the sidebar wordmark, use plain text "taskbash").

5. Show me the diff per file at the end.
```

Why: typo'd URLs hit Next's raw default 404 (looks like a side project). Brand logos torn-icon during CDN load gap. Both show up in screenshots and demos.

---

## 5. Surface silent load failures

```
Three pages quietly swallow load errors with .catch(() => []), so a failed Supabase fetch looks identical to "no data." Fix each:

1. app/(app)/handled/page.tsx:20 — replace .catch(() => []) with a real catch that throws or returns a discriminated result the page can render as an error state.

2. app/(app)/activity/page.tsx:31 — same fix.

3. app/(app)/observability/page.tsx:22 — same fix.

4. The calendar day-event fetch at today-calendar-column.tsx:302 also swallows errors — wrap with a try/catch that surfaces a small "Failed to load events" inline message instead of an empty popover.

5. activity/page.tsx:55 has a <Suspense> with no fallback — add a Skeleton (or extract a reusable <Skeleton> component from the existing CSS classes if one does not exist yet).

For each error case: keep the loading.tsx flow as-is, but make a failed load visually distinct from an empty result. The user should see "Failed to load — Retry" not a blank list.
```

Why: today, if Supabase blips during a page load, the user sees an empty page and has no idea what happened. They click around looking for their data, find none, assume the app is broken. Surfacing the failure lets them retry instead of bouncing.

---

## After all 5

1. Push to dev branch, verify the prod deploy passes.
2. Click around for 5 min: load /today, force-fail a fetch (disconnect wifi mid-load), double-click the snooze button, hit `/todayy`.
3. Hit `/sentry-test` once, confirm the error appears in Sentry within 60 seconds, then delete the page.
4. Watch Sentry for 24h. The first real error your users hit will tell you something you did not know about taskbash.

---

## What this does NOT cover

- Auth edge cases (expired sessions, race conditions on login)
- DB transaction safety
- Rate-limit handling (Anthropic 429s, Gmail quota)
- Long-running Inngest step retries
- Mobile responsive bugs

Separate passes. The five above are the universal ones every vibecoded app needs before it stops feeling broken when something goes wrong.

---

## Changelog vs the original draft

The original `polish-pass.md` (now stale at `~/Desktop/cos-app-v1/docs/polish-pass.md`) made three incorrect claims that have been corrected here:

1. Claimed Add-task clears on validation error → **false**, values are preserved (add-task-panel.tsx:154-177).
2. Claimed Send-Gmail can double-fire → **false**, already guarded with `disabled={busy}` + useTransition (today-view.tsx:2343-2370).
3. Claimed `/today/[taskId]` and other dynamic routes need `notFound()` calls → **false**, taskbash has zero dynamic routes.

The original also implied skeletons needed to be added globally — they already exist on every route via `loading.tsx`. The remaining gap is the silent `.catch` swallows, which is now its own prompt (#5).

You can delete the stale file at `~/Desktop/cos-app-v1/docs/polish-pass.md` whenever.
