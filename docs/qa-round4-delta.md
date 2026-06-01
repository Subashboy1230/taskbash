# QA Round 4 — Status check against recent commits

Walked the git log + browser to see which Round 1/2/3 findings have been resolved. Chrome extension dropped partway through verifying "Open in Gmail," but the codebase audit and the function-chip verification are complete.

## Confirmed fixed (verified in browser or in code)

### P0-9 — Function chip click no longer crashes the page (verified live)
Opened the SpendHound P0 detail panel, clicked the Product function chip. Result: chip moved into the selected state (filled pink background) without any error boundary, no `TypeError: network error`, no full-page crash. `app/settings/functions/actions.ts → setItemFunctions` is now wrapped in `try { … } catch (err) { return { ok: false, error: 'Network error. Try again.' } }` exactly as the fix plan recommended.

### P0-6 / P1-7 — Subtask cascade leak (verified in code)
Commit `dd6595b` ships the fix three places:

1. `lib/digest/run.ts` — removed the `for (const sub of parent.sub_items ?? []) allFresh.push(sub)` line that flattened subtasks into top-level siblings.
2. Same file — sub_items now written as child rows with `parent_id: inserted.id` and `source_ref: { auto_subtask: true }`.
3. `lib/load-digest.ts` line 30 — `.is('parent_id', null)` filter on the open-items query.
4. `app/today/actions.ts → generateItemDetails` guards against running on rows with `parent_id` set.

Migration `028_subtask_role.sql` adds the `role` column with default `'top'`, check `(role in ('top','subtask'))`, backfill `update items set role = 'subtask' where parent_id is not null`. **They used the existing `parent_id` column (not a new `parent_item_id`) — exactly the reviewer's pushback #1.**

**One latent issue:** the new subtask insert in `digest/run.ts` does NOT set `role: 'subtask'` on the row — it relies on the column default `'top'`. So freshly-created subtasks will have `role='top'` even though `parent_id` is set. load-digest filters by `parent_id IS NULL` so the bug is latent — any future query that filters by `role='top'` will accidentally include subtask rows. One-line fix: add `role: 'subtask' as const` to the `subInserts` map.

### P0-10 / E.6 — Send-now and Open-in-Gmail both go through the Drafts API (verified in code)
`dd6595b` rewrites `executeProposedAction`:

- **Send now** → if `gmail_draft_id` exists, `sendGmailDraft(draftId)` directly. Otherwise `createGmailDraft` first, persist the new `draftId`, then `sendGmailDraft`. On 403 (missing `gmail.modify` scope), falls back to opening `https://mail.google.com/mail/u/0/#drafts/{draftId}` instead of hard-erroring.
- **Open in Gmail** → also calls `createGmailDraft` first, then redirects to `#drafts/{draftId}`. The URL-mailto compose path is dead. MIME headers (In-Reply-To, References) are preserved because the draft is created via the API, so threading actually works.

This matches exactly what I described in the reply to reviewer pushback #3.

### Hardcoded `fromEmail = 'subash@sigiq.ai'` follow-up — done (verified in code)
`bebb5b5` swapped every literal `'subash@sigiq.ai'` in `app/today/actions.ts` for `await resolveUserEmail(userId)`.

### P1-12 — Re-run tasks no longer runs synchronously (verified in code)
`5408fa7` ("Fix Re-run: fire Inngest event instead of running digest synchronously") moved the heavy work to a background Inngest job. **This explains why my Round 2 + Round 3 Re-run tasks clicks spun forever** — the synchronous version held the request open for the full duration. Now the button fires an event and returns immediately; the digest runs in the background and re-validates `/today` on completion.

### Connections page hardening (verified in code)
Five commits in a row:
- `5557c66` Connections page crash on `.order('updated_at')` (column doesn't exist)
- `805b88d` Disconnect sticks; OAuth targets correct account
- `b718e52` Surface errors from `recordNangoConnection`
- `e6a6215` Switch Nango OAuth to ConnectUI iframe (no popups)
- `0a66614` Never rely on `APP_USER_ID`, always use session user

I didn't surface these in earlier rounds (avoided destructive Connect/Disconnect testing), but the area got significantly hardened.

## Confirmed still broken (re-verified in browser)

### P0-1 — Hydration #418 still fires
Fresh `/today` load at 10:16:46 PM. Console:

> Error: Minified React error #418; visit https://react.dev/errors/418?args[]=text — text content did not match.

Same error, same call site, same minified bundle path. Not addressed yet.

### P0-3 — `&#39;` entities still rendering
JS audit on fresh /today: **3 instances** of literal `&#39;` in body text (Round 1 had 3, Round 2 had 3, Round 3 had 2, Round 4 has 3 again). Same subtitle pipeline. Not addressed.

### P0-2 — Subtask duplication on the SpendHound task
Same task, same 10 subtasks, same near-duplicates:

- "Contact CEO upon return from India (Saturday) to schedule discussion about SpendHound benefits"
- "Schedule meeting with CEO upon return from India (Saturday) to discuss SpendHound benefits"  ← near-dup
- "Request QuickBooks admin access from CEO for platform integration setup"
- "Request QuickBooks admin access from CEO for platform integration"  ← near-dup
- "Confirm Thursday 2:30 PM follow-up call with SpendHound specialist for 5-10 minute dashboard integration"
- "Confirm Thursday 2:30 PM follow-up call with SpendHound specialist for integration"  ← near-dup

The cascade-leak fix protects against future cross-task leaks but doesn't dedupe within one parent's `sub_items`. The extractor prompt is still emitting overlapping subtasks. Worth a tighter prompt instruction ("each subtask must describe a distinct action, never reword an earlier subtask") and/or a post-generation simhash dedup.

### Round 3 P0s — no commits target these yet
- **P0-11** Empty-title Add task silent fail
- **P0-12** All-subtasks-done doesn't auto-complete parent
- **P0-13** `draft.followup` 365 calls/day still orphaned (where does this surface?)

## Status table across all rounds

| Round | Bug | Status |
|---|---|---|
| 1 | P0-1 Hydration #418 on /today | ❌ Still broken |
| 1 | P0-2 Subtask duplication on SpendHound | ❌ Still broken |
| 1 | P0-3 `&#39;` entity literals in subtitles | ❌ Still broken |
| 1 | P0-4 Open count mismatch (74 vs 82) | ⚠️ Not addressed |
| 1 | P0-5 Em-dashes in Voice content | ⚠️ Not regenerated |
| 2 | P0-6 Cascading subtask leak (root) | ✅ FIXED (dd6595b) |
| 2 | P0-7 Pencil-edit panel header stale | 🤷 Not re-verified |
| 2 | P0-8 Manual task contradictory auto-description | ⚠️ Not addressed |
| 2 | P0-9 Function chip click crashes page | ✅ FIXED (verified live) |
| 2 | P0-10 Open-in-Gmail URL doesn't thread | ✅ FIXED (dd6595b) |
| 2 | P1-7 Subtasks persisted as top-level items | ✅ FIXED (dd6595b) |
| 2 | P1-12 Re-run tasks spinner forever | ✅ FIXED (5408fa7) |
| 3 | P0-11 Empty title silent fail | ❌ Not addressed |
| 3 | P0-12 Mark all subtasks done ≠ parent auto-complete | ❌ Not addressed |
| 3 | P0-13 draft.followup 365 calls/day orphaned | ❌ Not addressed |
| 3 | P1-15 Linear "Rejected" pill meaning unclear | ❌ Not addressed |
| 3 | P1-16 No `aria-current="page"` | ❌ Not addressed |
| 3 | P1-17 No skip-to-content link | ❌ Not addressed |
| 3 | P2-9 ~15-min session expiry | ❌ Not addressed |
| — | Hardcoded subash@sigiq.ai follow-up | ✅ FIXED (bebb5b5) |
| — | Connections page crash | ✅ FIXED (5557c66) |
| — | Nango OAuth popup-blocker / connection ID race | ✅ FIXED (e6a6215, 8cd2794) |

## Highlights of new work shipped alongside the bug fixes

- **`f613bb9` Auto-Gmail-drafts on extraction** — the PRD I wrote earlier finally shipping. Reply drafts now land in the user's Gmail Drafts folder at the same time the reply task appears on /today. Needs a fresh QA pass once the Nango `gmail.modify` scope is approved.
- **`dd6595b` CC-aware drafts** — when the user is in Cc only (not To), the reply auto-targets the original sender. Claude prompt gets a `cc_only` flag so the tone matches an adjacent-manager perspective. Worth verifying with a real CC-only thread.
- **`dd6595b` Privacy + Terms pages** — `/privacy` and `/terms` with Google Limited Use disclosure, California-law clause, AI disclaimer. Should help with Google OAuth verification review.
- **`dd6595b` Meeting prep enrichment** — 120-day Granola lookback paginated to 200 notes with relevance scoring, plus past action items from the items DB matched on event-title keywords. `max_tokens` 800 → 1200.

## Suggested Round 5 priorities

1. **Verify auto-Gmail-drafts end-to-end** once the Nango `gmail.modify` scope is approved.
2. **CC-aware drafts** — find or simulate a CC-only thread and confirm the reply targets the original sender.
3. **Knock down the still-broken P0s in order**: P0-1 (hydration), P0-3 (entities), P0-2 (within-parent subtask dedup), P0-11 (empty title), P0-12 (auto-complete parent), P0-13 (draft.followup audit).
4. **Add `role: 'subtask' as const`** to the subtask insert in `digest/run.ts` — one-line cleanup, future-proofs queries that filter by role.

— Claude QA, round 4
