# PRD: taskbash onboarding

Hand this to Claude in Cursor. Self-contained — pairs with `CLAUDE.md`.

Status: spec + prototype. Prototype lives in this chat session (clickable widget). This doc is the buildable version.

---

## 1. Goal

Get a new user from "signed up via Google" to "saw their first auto-extracted action item from their real inbox" in under 5 minutes, with zero blank-page moments along the way.

Research-backed targets (Appcues + Chameleon studies cited in `docs/onboarding-research-notes.md`):
- Time-to-first-value under 5 minutes
- Activation rate (users who complete the flow) over 60%
- Personalization by role lifts activation 30-50%
- Interactive walkthroughs outperform static tutorials
- Pre-populated workspace beats empty state

Reference apps the flow is modeled on:
- Linear (multi-step horizontal flow, keyboard-friendly, polished animation)
- Notion (pre-populated workspace instead of empty canvas)
- Superhuman (white-glove feel, fast aha moment)
- Nummo (the specific competitor the user benchmarks against — synthesized subtitles, status pills, calm copy)

---

## 2. Eight screens

The clickable prototype shows these. Build them in this order.

| # | Screen | User does | Time | Aha factor |
|---|---|---|---|---|
| 1 | Welcome | Reads, clicks "Get started" | 5s | Sets expectation |
| 2 | Role pick | Picks one of 7 chips | 8s | Personalization signal |
| 3 | Pain pick | Multi-selects 1-3 pain cards | 10s | Prioritizes source order |
| 4 | Connect Gmail | OAuth flow | 30s | First commitment |
| 5 | Connect more sources | Optional Granola/Calendar/Linear | 30s | Expands coverage |
| 6 | Live extraction | Watches counter climb | 60-90s | **Aha moment** |
| 7 | First task tour | Clicks a real extracted task | 30s | Hands-on confidence |
| 8 | Done | Reads checklist, lands on /today | 5s | Closure + dopamine |

**Total: ~3-4 minutes wall time.**

---

## 3. Screen-by-screen spec

### Screen 1 — Welcome

**Copy:**
- H1: "Welcome to taskbash"
- Subtitle: "Your AI chief of staff. Auto-pulls action items from Gmail, meetings, and Linear so you can stop triaging and start shipping."
- CTA: "Get started"
- Footer: "Takes 3 minutes. No credit card."

**Visual:**
- Centered taskbash logo (use `public/logo-dark.svg`) at 80px
- All text centered
- Single primary CTA

**Behavior:**
- "Get started" → step 2
- Persist `onboarding.step = 1` to DB on mount

### Screen 2 — Role pick

**Copy:**
- H1: "What do you do most?"
- Subtitle: "We'll tailor function tags and copy to fit your work."

**Options (single-select chips):**
- Founder
- Operator
- PM
- Engineer
- Designer
- Sales
- Other

**Behavior:**
- On click, chip becomes selected (only one at a time)
- "Continue" enabled when one is picked; otherwise dimmed
- Selected value writes to `user_onboarding.role`
- Role drives:
  - Default `DEFAULT_FUNCTIONS` set seeded on screen 8 (Founder gets Product+GTM+Hiring+Ops+QA, Engineer gets Eng+QA+Product+Support, etc.)
  - Copy variants downstream (Engineer sees "Pull issues where you're @-mentioned" emphasized over "Reply to investors")

### Screen 3 — Pain pick

**Copy:**
- H1: "What's eating your time?"
- Subtitle: "Pick anything that lands. We prioritize what to surface first."

**Options (multi-select cards):**
- "Missing important emails" — Gmail icon, blue
- "Forgetting commitments from meetings" — Granola/microphone icon, amber
- "Losing track of Linear assignments" — checkbox icon, green

**Behavior:**
- Click toggles the card. Multi-select OK.
- "Continue" works regardless of selection (zero is OK)
- Writes array to `user_onboarding.pain_points`
- Pain selection re-orders the source priority on screen 5 (most-painful source listed first)

### Screen 4 — Connect Gmail (primary source)

**Copy:**
- H1: "Let's wire up your inbox"
- Subtitle: "Gmail is where most of your action items live. We'll read your last 7 days, extract what matters, and pre-draft replies you can send with one click."

**Card content:**
- Gmail icon at 44px
- "Connect Gmail" heading
- "Google OAuth via Nango. We never store email bodies." subtitle
- Big primary CTA: "Connect with Google"

**Behavior:**
- Click → Nango Connect popup with Gmail integration (`NANGO_PROVIDER_KEY.gmail`)
- On success: connection saved to `connections` table, popup closes, advance to step 5
- On failure: red banner under the card; user can retry
- "Skip for now" link at bottom advances to step 5 without connection

**Below the card:**
- Back button (left)
- Skip link (right, faint)

**Implementation:**
- Reuses the existing Nango Connect SDK already wired up at `/connections`. Trigger via the same `useNango()` hook (factor out if not already factored).

### Screen 5 — Connect more sources (optional)

**Copy:**
- H1: "Add more sources"
- Subtitle: "Optional. Each one expands what taskbash can extract."

**Cards in 2-column grid:**
- Granola (purple G icon) — "Pull commitments from your meeting notes"
- Google Calendar (calendar icon) — "Auto-generate prep briefs for upcoming meetings"
- Linear (purple L icon) — "Surface issues where you're @-mentioned"
- Slack (greyed) — "Coming in Week 5"

**Order:** sorted by `user_onboarding.pain_points` selection — if user picked "meetings" first, Granola lands first.

**Behavior:**
- Each card has its own Connect button
- For Granola + Linear: paste-API-key inline modal (existing pattern from `/connections`)
- For Calendar: Nango OAuth popup
- All connections optional; "Continue" works regardless

### Screen 6 — Live extraction (the aha moment)

**Copy:**
- Pre-launch label: "WORKING ON IT" (small, muted)
- Big animated number: starts at 0, counts up as items are found
- Stage label below: "Reading your inbox" → "Synthesizing context" → "Drafting replies" → "Tagging functions"
- Footer: "action items found"

**Behavior:**
- On mount, fires `requestRefresh()` server action
- Long-polls (every 1.5s) `pollOnboardingExtractionStatus(runId)` server action which reads progress from the new `onboarding_runs` table
- The number animates from previous count to new count each poll
- Progress bar fills as stages complete
- When done (all sources extracted), enable "See your tasks" CTA

**Backend:**
- New server action `startOnboardingExtraction(opts)` that:
  1. Inserts an `onboarding_runs` row with `status='running'`, `stage='extracting'`
  2. Fires `runDigestForUser({ userId, userEmail })` (existing pipeline)
  3. Updates `onboarding_runs.fresh_count` after each source completes
  4. Sets `status='done'` when all done
- Poll endpoint returns `{ stage, count, percent, done }`

**If user has no connections:** skip this screen and seed 3 demo tasks (see § 4) so they still see SOMETHING. Notion's "no empty workspace" rule.

### Screen 7 — First task tour

**Copy:**
- H1: "Your first task"
- Subtitle: "Try the core interaction. Click the row to see what taskbash synthesized."

**Layout:**
- A real task row (top-of-list from the extraction). Includes P1 badge, title, subtitle, "Draft ready" pill.
- Below the row: a Nummo-style yellow tooltip with arrow pointing up-left to the row: "Click the task. We pre-wrote a reply in your voice. One click to send."

**Behavior:**
- User clicks the row → DetailPanel Sheet slides in (existing component)
- Second tooltip appears INSIDE the panel pointing at the "Send draft" button: "Hit Send to ship the reply right now. Or Edit if you want to tweak."
- Third tooltip on the slop button: "Marked wrong? Click trash. The AI learns from every slop signal."
- "I got it" CTA at the bottom

**If extraction returned zero tasks:** show the seeded demo task instead.

### Screen 8 — Done

**Copy:**
- Checkmark in a green circle, 64px
- H1: "You're all set"
- Subtitle: "Your daily digest runs at 8 AM. You can re-run anytime. Mark anything wrong as slop and the AI learns."

**Checklist card ("What happens next"):**
- Sunrise icon — "Tomorrow at 8 AM, you'll get a fresh digest of overnight action items"
- Refresh icon — "Hit Re-run tasks anytime to pull what's new since"
- Trash icon — "Mark slop on anything wrong. The classifier gets sharper from every signal"

**CTA:** "Go to taskbash" → redirects to `/today` with `?welcome=1` query param so a one-time toast appears: "Welcome aboard. Here's your queue."

**Backend on completion:**
- Set `user_onboarding.completed_at = now()`
- Seed `user_functions` based on role:
  - Founder → Product, GTM, Hiring, Ops, QA
  - PM → Product, GTM, QA, Engineering, Design
  - Engineer → Engineering, QA, Product, Support
  - Designer → Design, Product, Engineering
  - Operator / Sales / Other → Product, Ops, QA, Hiring, GTM (the current defaults)
- Trigger the first morning-digest cron run so user has fresh data by tomorrow

---

## 4. Empty-state insurance (Notion pattern)

If after Screen 5 the user connected nothing, we still need to show SOMETHING on Screen 7. Otherwise the aha moment never lands.

Seed 3 demo tasks via `seedOnboardingDemoTasks(userId)` server action:

```ts
[
  {
    title: 'Reply to investor about Q3 update',
    subtitle: 'Sarah from Accel asked for the latest deck and metrics by Thursday.',
    tag: 'reply', source: 'manual', priority: 'P1',
    proposed_action: { kind: 'gmail_compose', to: ['sarah@accel.com'], subject: 'Re: Q3 update', body: 'Hi Sarah,\n\nThanks for the patience. Attaching the Q3 deck along with the metrics summary...' },
  },
  {
    title: 'Send Hollins the math curriculum sample',
    subtitle: 'You committed to sharing the G12 calculus pilot on Mentor Match.',
    tag: 'commit', source: 'manual', priority: 'P2',
  },
  {
    title: 'Review three open Linear issues',
    subtitle: 'PRD-166 + two follow-ups from yesterday have @-mentions waiting on you.',
    tag: 'action', source: 'manual', priority: 'P2',
  },
]
```

Mark each with `source_ref: { demo: true }` so they can be cleared en masse later if needed.

---

## 5. Database changes

### 5.1 `migrations/021_user_onboarding.sql`

```sql
create table user_onboarding (
  user_id uuid primary key references auth.users(id) on delete cascade,
  step int not null default 1,
  role text,
  pain_points text[],
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table user_onboarding enable row level security;
create policy "users manage own onboarding"
  on user_onboarding for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

### 5.2 `migrations/022_onboarding_runs.sql`

```sql
create table onboarding_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'running',
  stage text not null default 'extracting',
  fresh_count int default 0,
  percent int default 0,
  error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create index onboarding_runs_user_idx on onboarding_runs(user_id, started_at desc);

alter table onboarding_runs enable row level security;
create policy "users read own runs"
  on onboarding_runs for select
  using (auth.uid() = user_id);
```

---

## 6. Routes + components

```
app/onboarding/
├── page.tsx                       Server component, redirects to current step
├── onboarding-shell.tsx           Client component, handles step state + URL sync
├── steps/
│   ├── step-1-welcome.tsx
│   ├── step-2-role.tsx
│   ├── step-3-pain.tsx
│   ├── step-4-connect-gmail.tsx
│   ├── step-5-connect-more.tsx
│   ├── step-6-extracting.tsx       Polls extraction status
│   ├── step-7-tour.tsx             Renders real or demo first task
│   └── step-8-done.tsx
└── actions.ts                     Server actions
```

**Route guards:**

- `app/today/page.tsx` (and every other authenticated page) checks on the server:
  ```ts
  const onboarding = await loadOnboardingState(userId)
  if (!onboarding.completed_at) redirect('/onboarding')
  ```
- `app/onboarding/page.tsx` checks the inverse:
  ```ts
  if (onboarding.completed_at) redirect('/today')
  ```
- A query param `?force=1` on `/onboarding` lets the user re-run it (useful for testing).

**Server actions in `app/onboarding/actions.ts`:**

```ts
'use server'

export async function updateOnboardingStep(step: number, data?: Partial<{ role: string; pain_points: string[] }>): Promise<void>
export async function startOnboardingExtraction(): Promise<{ runId: string }>
export async function pollOnboardingExtractionStatus(runId: string): Promise<{ stage: string; count: number; percent: number; done: boolean }>
export async function completeOnboarding(): Promise<void>  // sets completed_at + seeds functions
export async function seedOnboardingDemoTasks(): Promise<void>  // if no connections after step 5
```

---

## 7. Personalization details (the 30-50% activation lift)

Three places where role + pain choices visibly change downstream behavior:

1. **Screen 5 source order.** If user picked "Forgetting meeting commitments" as a pain, Granola card appears first. If "Losing Linear assignments", Linear first. Default order otherwise.

2. **Screen 7 first task selection.** When picking which extracted task to feature in the tour, prefer:
   - If user picked "Missing emails" → pick a `tag='reply'` from Gmail
   - If user picked "Meeting commitments" → pick a `tag='commit'` from Granola
   - If user picked "Linear assignments" → pick a Linear item

3. **Screen 8 function seeding.** Role → DEFAULT_FUNCTIONS mapping in § 3 step 8 backend. These get inserted into `user_functions` and immediately visible on /today.

---

## 8. Animation + delight details

Where the polish lives:

- **Step transitions:** 200ms fade-out + fade-in, no slide. Snappy.
- **Chip / card selection:** background swaps to brand color with 100ms ease.
- **Screen 6 counter:** counts up at ~90ms per number using `setInterval`. Each stage advances when the count reaches the target.
- **Screen 6 progress bar:** transitions `width` over 800ms ease-out.
- **Screen 7 tooltips:** appear 400ms after the previous interaction, with a subtle scale-from-0.96 animation.
- **Screen 8 checkmark:** the circle scales from 0 to 1 over 300ms on mount, then a checkmark stroke draws over 250ms (`stroke-dashoffset` animation).
- **All sounds:** none. No audio.
- **All confetti:** none. Restraint is the brand.

---

## 9. Mobile considerations (deferred)

The onboarding is desktop-only for v1. Mobile users see a polite "taskbash works best on desktop right now — please open this on your computer to get started" message. Building responsive onboarding doubles the spec; defer to post-launch.

---

## 10. Testing

After build:

```bash
npx tsc --noEmit
npm run build
npm run dev

# Manual test in browser:
# 1. Sign in as a fresh user (clear cookies or use a test account)
# 2. Should auto-redirect to /onboarding from /today
# 3. Click through all 8 steps; verify URL stays /onboarding?step=N
# 4. Refresh in the middle; verify state persists
# 5. Complete; verify redirect to /today with ?welcome=1 toast
# 6. Try /onboarding again; verify redirect back to /today
# 7. Try /onboarding?force=1; verify it shows the flow again
```

Edge cases to verify:
- User closes the tab on step 4 (Gmail connect popup). Reopen `/onboarding`. State is on step 4, no Gmail connected.
- User connects Gmail then skips everything else. Extraction screen runs successfully.
- User connects nothing. Demo tasks are seeded. Screen 7 shows a demo task.
- Extraction fails (Gmail API error). Screen 6 shows error + retry button. User can skip to demo.

---

## 11. Acceptance criteria

The PRD is implemented correctly when:

- [ ] New user signing up via Google SSO is auto-redirected to `/onboarding`
- [ ] All 8 steps render with the copy specified in § 3
- [ ] URL syncs to `?step=N`; refresh preserves progress
- [ ] Role selection persists to `user_onboarding.role`
- [ ] Pain selection persists to `user_onboarding.pain_points`
- [ ] Source order on Screen 5 respects pain selection
- [ ] Gmail OAuth flow works end-to-end via Nango
- [ ] Screen 6 polls extraction status and animates the counter
- [ ] Screen 6 completes within ~90 seconds for a typical 12-item extraction
- [ ] Screen 7 features a real task if one was extracted; demo otherwise
- [ ] Screen 8 seeds `user_functions` based on role
- [ ] On complete, redirect to `/today?welcome=1` with a one-time toast
- [ ] Any authenticated page that's not `/onboarding` redirects unfinished users to `/onboarding`
- [ ] `?force=1` re-runs the flow for testing
- [ ] tsc + next build clean
- [ ] No em-dashes anywhere in onboarding UI strings

---

## 12. Out of scope (do not build)

- Mobile-optimized version
- A/B testing infrastructure (defer until we have a baseline)
- Email-based re-engagement for users who abandon mid-flow
- Tooltips for every UI surface beyond /today (just /today is in scope)
- "Skip to product" power-user shortcut (keep the flow forced for now)

---

## 13. Gotchas

1. **Em-dash ban applies.** Use hyphens, colons, periods. The wordmark and prompts already follow this rule.
2. **Gmail OAuth popup blockers.** Trigger from a button click handler (user gesture) to avoid Safari blocking it.
3. **Nango connection IDs are per-user-per-integration.** `subash@sigiq.ai` connecting twice should be idempotent. The Nango SDK handles this; just verify.
4. **Extraction screen needs a maximum timeout.** If extraction takes >3 minutes, fall back to "We're still processing. Come back in a few minutes" + advance to step 7 with seeded demo.
5. **Role → functions mapping is in code, not DB.** Centralize in `lib/onboarding/role-functions.ts` so it's editable in one place.
6. **The shadcn primitives this needs are all already in the project.** Button, Card, Input (for paste-API-key flows), Sheet (for the tour tooltips), Tabs (not needed for onboarding but used elsewhere). No new primitives.
7. **Tabler icons are already loaded** via the existing `<i class="ti ti-..." />` pattern. Use them.
8. **Localhost dev server must restart** after running new migrations (021 + 022) — the Supabase typegen needs to refresh.
9. **Onboarding routes must NOT use `PageShell`** (the 3-column sidebar/calendar layout). They're a dedicated full-page experience with no sidebar.
10. **Time-to-first-extracted-task is the metric.** Instrument it via `agent_events` so we can see if we hit the <5 min target. Insert a row `kind='onboarding.completed'` with `payload: { duration_ms }`.

---

## 14. One-paragraph TL;DR

> Build an 8-screen onboarding at `/onboarding` that runs before any authenticated page. Screens 1-3 personalize via role + pain picks. Screens 4-5 connect Gmail (primary) and optionally Granola/Calendar/Linear via existing Nango flow. Screen 6 runs the digest pipeline and animates the action-item count. Screen 7 walks the user through their first real extracted task using tooltips. Screen 8 seeds `user_functions` from their role and redirects to `/today`. Two migrations: `user_onboarding` (per-user state) and `onboarding_runs` (extraction progress polling). New `app/onboarding/` directory with 8 step components plus `actions.ts`. Empty-state insurance: if no connections succeed, seed 3 demo tasks so screen 7 still works. Personalization details lift activation 30-50% — role drives function seeding + source ordering, pain drives source priority + featured-task selection. Polish is the differentiator: 200ms transitions, counter animation, restrained delight, no confetti. Desktop-only for v1. Acceptance is in §11. No em-dashes.
