# PRD: /profile page

Hand this to Claude in Cursor. Self-contained — open alongside `CLAUDE.md` and the assistant has everything it needs to implement.

Status: spec, not built. Tracks decisions made on 2026-05-30 with Subash.

---

## 1. Goal

Give Subash a single page to see and tune what the agent has learned about him, what instructions the agent operates under, and how the agent is performing. Three jobs in one surface:

1. **Trust** — make the AI behavior legible. Show the prompts. Show the learned voice.
2. **Tune** — let Subash regenerate his voice and submit prompt-edit suggestions without an engineer in the loop.
3. **Reward** — give him dopamine via cleared-count cards, a slop chart, and "top function this week."

The page is at `/profile`. Replaces the existing placeholder. Uses shadcn `Tabs` with four panels: **Overview**, **Voice**, **Prompts**, **Stats**.

---

## 2. Decisions locked

| Decision | Choice | Why |
|---|---|---|
| Page structure | Tabs within `/profile`: Overview / Voice / Prompts / Stats | Single URL, easy to share, low nav cost |
| Voice section | Read-only + "Regenerate from last 30 days" button | Simple, no risk of breaking voice quality via direct edit |
| Prompts section | Read + "Suggest a tweak" textarea writes to a feedback table; engineer applies via PR | Transparency now, controlled rollout of changes |
| Stats section | Cleared counts (today/week/month) + slop rate per source over 30d + top function this week | Pure dopamine + one actionable signal (slop trend) |
| Naming | "Voice" everywhere — rename current "Soul" identifier across code + docs | Less mystical, clearer to non-technical users |

---

## 3. Pre-work: Soul → Voice rename

Do this **first** as a standalone commit so the rest of the PRD lands cleanly. No behavior change, pure rename.

**Code references to update:**

| File | Current | After |
|---|---|---|
| `lib/draft/reply.ts` | `const soul = await loadSoul()` and `Communication style:\n${soul}` | `const voice = await loadVoice()` and `Voice:\n${voice}` |
| `lib/draft/followup.ts` | Same pattern (twice) | Same rename |
| `scripts/analyze-soul.ts` | Rename file → `scripts/analyze-voice.ts` | |
| `package.json` | `"analyze:soul": "tsx scripts/analyze-soul.ts"` | `"analyze:voice": "tsx scripts/analyze-voice.ts"` |
| `CLAUDE.md` | Section 13 mentions "Soul" — learned communication style | "Voice" — learned communication style |
| Any docs in `docs/` mentioning Soul | grep + replace | |

**Database** — leave `users.communication_style` column name as-is (it's already neutral and renaming would require a migration). Just update the variable name in code that reads/writes it.

**Search check after rename:** `grep -rn "soul\|Soul\|SOUL" lib/ app/ scripts/ docs/ --include="*.ts" --include="*.tsx" --include="*.md"` should return zero hits except in CHANGELOG/git history.

---

## 4. Page architecture

### 4.1 URL and shell

- Route: `/profile` (existing placeholder at `app/profile/page.tsx`)
- Page is a **server component** that loads all data needed for all four tabs upfront. Avoids per-tab loading spinners. The data sets are small enough (no per-row pagination needed).
- Tabs are a **client component** because `<Tabs>` from shadcn needs interactivity.
- Wrap the page in the existing `PageShell` (sidebar + main + calendar column) so the profile feels native to the rest of the app.

```
app/profile/
├── page.tsx                   ← server component; loads digest summaries, voice, prompts, stats
├── profile-tabs.tsx           ← client; the tabs container + state
├── tabs/
│   ├── overview-tab.tsx       ← identity + connections summary
│   ├── voice-tab.tsx          ← voice display + regenerate
│   ├── prompts-tab.tsx        ← prompt list + suggest-edit form
│   └── stats-tab.tsx          ← three cards + chart + top-function
└── actions.ts                 ← server actions (regenerateVoice, suggestPromptEdit)
```

### 4.2 Tab order and default

Default tab on first load: **Overview**. Persist last-selected tab in `localStorage` under `taskbash:profileTab` so returning users land where they left off. Tab state is also URL-sync'd via `?tab=voice` so links can deep-link to a specific tab.

---

## 5. Tab specs

### 5.1 Overview tab

Purpose: who you are, what's connected, the snapshot.

**Sections (stacked Card components):**

**A. Identity card.**
- Avatar (magenta circle with initial, same as sidebar)
- Display name (from `auth.users.user_metadata.full_name` or fallback to email-local)
- Email (from session)
- Time zone (read from `Intl.DateTimeFormat().resolvedOptions().timeZone`; display only)
- "Member since" — `auth.users.created_at` formatted as "May 12, 2026"
- A "Sign out" button (same action that's currently in the sidebar)

**B. Connections summary card.**
- A row per source (Gmail / Granola / Linear / Calendar / Slack) with:
  - Brand logo (existing `<BrandLogo />`)
  - Source name
  - Connected status: green dot + "Connected" or gray dot + "Not connected"
  - Link to `/connections` for management
- Slack row says "Coming in Week 5" (existing copy).

**C. Quick-stats strip.**
- Three small inline numbers (no Card wrapper):
  - "X open" — total `status='open'` items
  - "Y cleared today" — `status='completed'` AND `completed_at >= start of today`
  - "Z drafts ready" — items with `proposed_action IS NOT NULL` AND `reply_outcome IS NULL`
- Each number 18px semibold, label 11px muted. One-line layout.

No charts on Overview. The Stats tab owns the data viz.

### 5.2 Voice tab

Purpose: show Subash what the agent has learned about how he writes. Let him refresh it on demand.

**Layout:**

**A. Header row.**
- Title: "Voice"
- Subtitle: "How the agent writes on your behalf. Updated every 30 days or when you regenerate."
- Right side: "Last updated 14 days ago" muted text.

**B. Voice profile card.**
- Big block of text — the current `users.communication_style` value, rendered as plain text in a Card with `font-mono` to make it feel like a system-readable artifact.
- If empty / never run: empty state copy: "We haven't analyzed your voice yet. Click Regenerate to build it from your last 30 days of sent emails."

**C. Examples card.**
- Below the profile, show 3-5 actual example openers and closers extracted from the user's sent folder.
- Schema for these is new: store on `users.voice_examples` as `jsonb`:
  ```json
  {
    "openers": ["Hey Karim,", "Thanks for the quick reply.", "Hi Anna —"],
    "closers": ["Best,\nSubash", "Cheers,\nSubash", "Talk soon,\nS"]
  }
  ```
- Render as two columns: "How you open" / "How you close." Each item in a small pill / quote card.
- If empty: hide the section.

**D. Regenerate action.**
- Primary button: "Regenerate from last 30 days"
- On click: disabled, spinner, "Analyzing your sent emails…"
- Calls `regenerateVoice()` server action (see § 6.1)
- On success: page refetches and the new voice is visible.
- On failure: red banner with the error message.

**E. Privacy note** at the bottom (faint text, 12px): "Your voice profile is generated by Claude reading your last 30 days of sent emails. The emails are not stored; only the resulting profile is saved."

### 5.3 Prompts tab

Purpose: full transparency into the agent's instructions, plus a friction-free way to suggest edits.

**Layout:**

**A. Header row.**
- Title: "Agent prompts"
- Subtitle: "Every system prompt the AI uses. Read what it's instructed to do. Suggest changes if something feels off."

**B. Prompt list.**

The agent uses these prompts (sourced from the codebase):

| prompt_id | File | Purpose |
|---|---|---|
| `extract.gmail` | `lib/extract/gmail.ts` | Pull action items from Gmail threads |
| `extract.granola` | `lib/extract/granola.ts` | Pull action items from Granola meeting notes |
| `extract.calendar` | `lib/extract/calendar.ts` (PREP_BRIEF_PROMPT) | Generate prep briefs for upcoming events |
| `classify.functions` | `lib/classify/functions.ts` | Assign function tags to extracted items |
| `brief.synthesize` | `lib/brief.ts` | Generate the why/know/done/next brief |
| `draft.reply` | `lib/draft/reply.ts` | Pre-draft Gmail replies |
| `draft.followup` | `lib/draft/followup.ts` | Decide if a meeting commitment warrants a follow-up email |

For each prompt, render an expandable Card. Collapsed view:
- prompt_id (mono font)
- Short human-readable name ("Gmail extractor")
- Current version (e.g., "v3")
- Last-30-day slop rate badge (e.g., "Slop 12%" green if <15%, amber 15–30%, red >30%)
- Expand chevron

Expanded view shows:
- Full prompt text in a code-styled block (mono font, syntax-highlighted minimally — just preserve indentation)
- A "Suggest a tweak" button at the bottom

Clicking "Suggest a tweak" opens an inline editor (no modal):
- A read-only diff view of the current prompt (collapsible)
- A textarea labeled "What should change?" with placeholder "e.g. The classifier is over-tagging Product. Maybe weight 'design' / 'engineering' nouns more heavily."
- An optional "What outcome are you trying to fix?" textarea
- Submit button "Send suggestion"

On submit, call `suggestPromptEdit({ promptId, currentVersion, suggestion, outcome })` (see § 6.2). Success: green toast "Suggestion captured. Engineer will review." The Cards's expanded panel collapses.

**C. How to load prompt text into the page.**

The prompt strings live inside extractor files as TS constants (`SYSTEM_PROMPT`, `PREP_BRIEF_PROMPT`, etc.). Two options:

- **Option 1 (recommended):** Create `lib/prompt-registry.ts` that re-exports each prompt as `{ id, version, fileRef, text }`. The registry is the single source of truth — extractors import from it instead of defining the constant inline. The /profile page also imports from it.
- **Option 2:** Hard-code the prompt text in the registry file and risk drift between the actual extractor prompt and the displayed one. Faster but fragile.

Go with Option 1. The registry file:

```ts
// lib/prompt-registry.ts
export interface PromptDef {
  id: string
  version: number
  shortName: string
  file: string
  text: string
}

export const PROMPTS: Record<string, PromptDef> = {
  'extract.gmail': {
    id: 'extract.gmail',
    version: 3,
    shortName: 'Gmail extractor',
    file: 'lib/extract/gmail.ts',
    text: `You extract action items owned by a specific user from their email threads.\n\n...`,
  },
  // ... rest
}
```

Each extractor file then does `import { PROMPTS } from '@/lib/prompt-registry'` and uses `PROMPTS['extract.gmail'].text`. Bump `version` whenever the text changes.

### 5.4 Stats tab

Purpose: dopamine + one actionable trend.

**A. Cleared-count cards.**

Three side-by-side big-number cards:

```
Today        This week     This month
   3            27            142
tasks cleared tasks cleared tasks cleared
```

Number 36px semibold. Label "tasks cleared" 11px muted. Equal-width grid. Hover lifts the card slightly.

Queries:
- Today: `count(*) where user_id = $1 and status = 'completed' and completed_at >= date_trunc('day', now())`
- Week: same but `completed_at >= date_trunc('week', now())`
- Month: same but `completed_at >= date_trunc('month', now())`

**B. Slop rate by source over 30 days.**

A line chart, one line per source. X-axis = day (last 30). Y-axis = slop rate % (0–100).

Slop rate per source per day:
```sql
select
  date_trunc('day', i.created_at) as day,
  i.source,
  count(*) filter (where if.id is not null)::float / nullif(count(*), 0) * 100 as slop_pct
from items i
left join item_feedback if on if.item_id = i.id and if.kind = 'slop'
where i.user_id = $1 and i.created_at >= now() - interval '30 days'
group by 1, 2
order by 1
```

Render with Recharts (already in dependency list). Each source gets a distinct stroke color from the function palette: Gmail blue, Granola amber, Linear purple, Calendar teal.

Chart height ~200px. Tooltip on hover shows `Apr 12 · Gmail · 14%`.

Below the chart: a one-line takeaway: "Gmail's slop rate is up 8 points this week. Consider reviewing recent slop in /observability."

(Generate the takeaway server-side by comparing this week's avg to last week's avg per source. Simple delta math, no LLM.)

**C. Top function this week.**

One sentence in a callout-style card:

```
You spent most of this week on Product.
24 tasks tagged, ~38% of your week.
```

Query: top function by count of items where `function_ids @> ARRAY[function_id]::uuid[]` AND `created_at >= start of week`, grouped by function. Pick the top one. Compute % as `top_count / total_count * 100`.

If no functions have tagged items this week: hide the card or show "No function tagged tasks yet this week."

---

## 6. Server actions

All in `app/profile/actions.ts`. All start with `'use server'`.

### 6.1 `regenerateVoice()`

```ts
export async function regenerateVoice(): Promise<{ ok: true } | { ok: false; error: string }>
```

Steps:
1. `resolveUserId()` from session
2. Look up Gmail connection (`getActiveConnection('gmail')`). If not connected → return `{ ok: false, error: 'Connect Gmail first.' }`
3. Fetch last 30 days of sent emails via Nango proxy (`q: 'in:sent newer_than:30d'`, `maxResults: 100`)
4. Concatenate the bodies into a single transcript (trim to ~50k chars)
5. Call Claude (via `tracedMessage`, `prompt_id: 'analyze.voice'`) with a system prompt that asks for:
   - 2-3 sentence voice description
   - 5 example openers (verbatim from the emails)
   - 5 example closers (verbatim from the emails)
6. Parse JSON: `{ voice, openers, closers }`
7. Persist to `users.communication_style` (voice text) and `users.voice_examples` (jsonb)
8. `revalidatePath('/profile')`
9. Return `{ ok: true }`

Errors are caught and returned as `{ ok: false, error }` so the UI can show a banner.

### 6.2 `suggestPromptEdit(args)`

```ts
export async function suggestPromptEdit(args: {
  promptId: string
  currentVersion: number
  suggestion: string
  outcome?: string
}): Promise<{ ok: true } | { ok: false; error: string }>
```

Inserts a row into a new table `prompt_suggestions` (see § 7.2). No external side effects — engineer reads the table later.

Validation:
- `promptId` must be a key in `PROMPTS` registry
- `suggestion` must be non-empty, max 5000 chars
- `outcome` max 2000 chars

On success, `revalidatePath('/profile')` to refresh any "X suggestions sent" counter.

### 6.3 Read functions (server, not actions — called from `page.tsx`)

- `loadProfileOverview(userId)` — identity + connection statuses + quick-stats
- `loadVoiceProfile(userId)` — current voice text + examples + last-updated timestamp
- `loadPromptsWithSlopRates(userId)` — PROMPTS registry + per-prompt last-30d slop rate
- `loadStats(userId)` — cleared counts + slop time series + top function

---

## 7. Database changes

Three migrations. Apply in order.

### 7.1 `migrations/018_voice_examples.sql`

```sql
-- Voice examples extracted alongside the voice profile.
-- jsonb shape: { openers: string[], closers: string[] }
alter table users add column voice_examples jsonb;
alter table users add column voice_updated_at timestamptz;

comment on column users.voice_examples is
  'Example openers + closers extracted from sent emails when voice was last regenerated.';
comment on column users.voice_updated_at is
  'When users.communication_style and users.voice_examples were last refreshed.';
```

### 7.2 `migrations/019_prompt_suggestions.sql`

```sql
create table prompt_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  prompt_id text not null,
  prompt_version integer not null,
  suggestion text not null,
  outcome text,
  status text not null default 'open',  -- open | acknowledged | applied | rejected
  reviewed_at timestamptz,
  reviewer_note text,
  created_at timestamptz not null default now()
);

create index prompt_suggestions_user_id_idx on prompt_suggestions(user_id);
create index prompt_suggestions_prompt_id_idx on prompt_suggestions(prompt_id);
create index prompt_suggestions_open_idx on prompt_suggestions(status) where status = 'open';

-- RLS: users can insert + read their own; service role reads all.
alter table prompt_suggestions enable row level security;
create policy "users insert own suggestions"
  on prompt_suggestions for insert
  with check (auth.uid() = user_id);
create policy "users read own suggestions"
  on prompt_suggestions for select
  using (auth.uid() = user_id);
```

### 7.3 `migrations/020_voice_examples_default.sql` (optional cleanup)

If you want to backfill `voice_updated_at` for users who already have a `communication_style` set:

```sql
update users
set voice_updated_at = updated_at
where communication_style is not null
  and voice_updated_at is null;
```

---

## 8. Type updates

In `lib/types.ts`, add:

```ts
export interface VoiceExamples {
  openers: string[]
  closers: string[]
}

export interface UserRecord {
  // ... existing fields
  communication_style: string | null
  voice_examples: VoiceExamples | null
  voice_updated_at: string | null
}

export interface PromptSuggestion {
  id: string
  user_id: string
  prompt_id: string
  prompt_version: number
  suggestion: string
  outcome: string | null
  status: 'open' | 'acknowledged' | 'applied' | 'rejected'
  reviewed_at: string | null
  reviewer_note: string | null
  created_at: string
}
```

---

## 9. Components to build

Net new shadcn primitives needed: none. The existing `app/_components/ui/` set (Tabs, Card, Button, Input, Textarea, Sheet) covers everything.

**New components (in `app/profile/` tree):**

| Component | Where | Purpose |
|---|---|---|
| `ProfileTabs` | `profile-tabs.tsx` | Client wrapper, shadcn Tabs with localStorage + URL sync |
| `OverviewTab` | `tabs/overview-tab.tsx` | Identity + connections + quick stats |
| `VoiceTab` | `tabs/voice-tab.tsx` | Voice profile + examples + regenerate button |
| `PromptCard` | `tabs/prompts-tab.tsx` | Single expandable prompt with suggest-edit form |
| `PromptsTab` | `tabs/prompts-tab.tsx` | Maps PROMPTS registry to PromptCards |
| `StatsTab` | `tabs/stats-tab.tsx` | Three cards + chart + top function |
| `ClearedCountCard` | `tabs/stats-tab.tsx` | Reusable big-number card |
| `SlopChart` | `tabs/stats-tab.tsx` | Recharts line chart |
| `TopFunctionCallout` | `tabs/stats-tab.tsx` | One-sentence callout |

Need a new shadcn primitive: **Textarea** (for the suggest-edit form). Quick add:

```tsx
// app/_components/ui/textarea.tsx
import * as React from 'react'
import { cn } from '@/lib/utils'

const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
)
Textarea.displayName = 'Textarea'

export { Textarea }
```

---

## 10. Wireframe (ASCII so Cursor can render mentally)

```
┌──────────────────────────────────────────────────────┐
│ Profile                                              │
│                                                      │
│ [Overview]  [Voice]  [Prompts]  [Stats]              │
│ ──────────                                           │
│                                                      │
│ ┌─ Identity ───────────────────────────────────┐    │
│ │  ⬤ Subash                                     │    │
│ │    subash@sigiq.ai · PT · member since May 26 │    │
│ │                                  [Sign out]   │    │
│ └───────────────────────────────────────────────┘    │
│                                                      │
│ ┌─ Connections ────────────────────────────────┐    │
│ │  ✉  Gmail        ● Connected                 │    │
│ │  G  Granola      ● Connected                 │    │
│ │  ◐  Linear       ● Connected                 │    │
│ │  📅 Calendar     ● Connected                 │    │
│ │  ⌗  Slack        ○ Coming in Week 5          │    │
│ └───────────────────────────────────────────────┘    │
│                                                      │
│   184 open     ·     3 cleared today     ·    8 drafts ready │
│                                                      │
└──────────────────────────────────────────────────────┘
```

```
┌─ Voice tab ──────────────────────────────────────────┐
│  Voice                                               │
│  How the agent writes on your behalf.                │
│  Last updated 14 days ago.                           │
│                                                      │
│ ┌─ Profile ────────────────────────────────────┐    │
│ │  Direct, warm but no fluff. Opens with a     │    │
│ │  first name + comma. Closes with "Best,      │    │
│ │  Subash" or "Talk soon, S". Avoids cor-      │    │
│ │  porate language. Replies in 2-4 sentences.  │    │
│ └───────────────────────────────────────────────┘    │
│                                                      │
│ ┌─ How you open ──┐  ┌─ How you close ──┐           │
│ │ Hey Karim,       │  │ Best,             │           │
│ │ Thanks Anna —    │  │ Cheers,           │           │
│ │ Hi Karttikeya,   │  │ Talk soon, S      │           │
│ └──────────────────┘  └───────────────────┘           │
│                                                      │
│  [Regenerate from last 30 days]                     │
│                                                      │
│  ⓘ Your voice profile is generated by Claude         │
│    reading your last 30 days of sent emails…        │
└──────────────────────────────────────────────────────┘
```

```
┌─ Prompts tab ────────────────────────────────────────┐
│  Agent prompts                                       │
│  Read what the AI is instructed to do.               │
│                                                      │
│ ┌──────────────────────────────────────────────┐    │
│ │ extract.gmail · v3 · Slop 12% 🟢          ▾  │    │
│ └──────────────────────────────────────────────┘    │
│ ┌──────────────────────────────────────────────┐    │
│ │ extract.granola · v2 · Slop 18% 🟡         ▾  │    │
│ └──────────────────────────────────────────────┘    │
│ ┌──────────────────────────────────────────────┐    │
│ │ classify.functions · v1 · Slop 7%  🟢      ▴  │    │
│ │ ───────────────────────────────────────────  │    │
│ │ ```                                          │    │
│ │ You assign FUNCTION TAGS to a user's tasks. │    │
│ │ ...                                          │    │
│ │ ```                                          │    │
│ │                       [Suggest a tweak]      │    │
│ └──────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────┘
```

```
┌─ Stats tab ──────────────────────────────────────────┐
│  ┌─ Today ─┐  ┌─ Week ─┐  ┌─ Month ─┐               │
│  │   3     │  │   27    │  │   142   │               │
│  │ cleared │  │ cleared │  │ cleared │               │
│  └─────────┘  └─────────┘  └─────────┘               │
│                                                      │
│ ┌─ Slop rate, last 30 days ────────────────────┐    │
│ │ [line chart, 4 lines, one per source]        │    │
│ └───────────────────────────────────────────────┘    │
│  Gmail's slop rate is up 8 points this week.        │
│                                                      │
│ ┌─────────────────────────────────────────────┐     │
│ │ You spent most of this week on Product.      │     │
│ │ 24 tasks tagged, ~38% of your week.         │     │
│ └─────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────┘
```

---

## 11. Ship order (3 working days)

### Day 1 — foundation

- **Morning:** Soul → Voice rename across codebase (one commit, dev-branch push)
- **Afternoon:** Create `lib/prompt-registry.ts`, migrate all extractor prompts into it, verify build + extractors still work
- **End of day:** Apply migration 018 (`voice_examples` + `voice_updated_at`)

### Day 2 — page scaffold + Overview + Voice tabs

- **Morning:** Build `app/profile/page.tsx` + `profile-tabs.tsx` + `tabs/overview-tab.tsx`. Verify the three quick-stat numbers render correctly.
- **Afternoon:** Build `tabs/voice-tab.tsx` + `regenerateVoice()` server action. End-to-end test: click button, see new voice + examples.

### Day 3 — Prompts + Stats

- **Morning:** Apply migration 019. Build `tabs/prompts-tab.tsx` with PromptCard expand/collapse + suggest-edit form. Wire `suggestPromptEdit()`.
- **Afternoon:** Build `tabs/stats-tab.tsx`. The slop chart is the only non-trivial piece — get the query working in a script first, then drop into Recharts.

---

## 12. Acceptance criteria

The PRD is implemented correctly when:

- [ ] No mention of "soul" remains in `lib/`, `app/`, `scripts/`, `docs/` (excluding git history)
- [ ] `lib/prompt-registry.ts` exports every system prompt used by an extractor or drafter
- [ ] All extractor files import their prompt from the registry (no inline `SYSTEM_PROMPT` constants)
- [ ] `/profile` renders four tabs and the URL updates as you switch (`?tab=stats` etc.)
- [ ] Default tab on first visit is Overview; subsequent visits respect `localStorage['taskbash:profileTab']`
- [ ] Identity card shows the right name, email, and member-since date
- [ ] Connections card shows correct connected/disconnected status for all five sources
- [ ] Quick-stats numbers match what's shown on `/today`
- [ ] Voice tab shows the current `communication_style` text in a Card
- [ ] Voice tab shows up to 5 openers + 5 closers from `users.voice_examples` (or hides if null)
- [ ] "Regenerate from last 30 days" button works end to end: triggers Claude analysis, persists the new voice, page refreshes
- [ ] Prompts tab lists all 7 prompts in collapsed cards
- [ ] Each prompt card shows the live slop rate computed from `llm_calls` + `item_feedback`
- [ ] Expanding a prompt card shows the full prompt text in a mono code block
- [ ] "Suggest a tweak" submits to `prompt_suggestions` table and shows a success toast
- [ ] Stats tab shows three cleared-count cards with correct numbers
- [ ] Slop chart renders a line per source over 30 days
- [ ] Top function callout shows the right function + percentage
- [ ] All copy is em-dash free
- [ ] `npx tsc --noEmit` clean
- [ ] `npm run build` clean

---

## 13. Future work (explicitly NOT in scope)

These will be obvious to add later but should not be built now:

- Voice quality A/B testing (compare two voice profiles' draft outputs)
- Live prompt editing (Option C from the decision matrix — skipped)
- Per-source toggle to disable extraction temporarily
- Notification preferences (when to send the morning digest, what to push to Slack)
- Working hours / quiet hours
- Time-zone override (we read from browser today; let user pin a TZ)
- Data export (CSV of items, jsonb of voice)
- Account deletion flow
- Billing surface (no plans yet)

If Cursor adds any of these without being asked, send back a "scope creep" note.

---

## 14. Gotchas

1. **The em-dash ban applies to this PRD's UI copy too.** Don't sneak `—` into the page text. Use hyphens, colons, periods.

2. **`tracedMessage` for the voice analyzer.** Wrap the Claude call in `tracedMessage(anthropic, { prompt_id: 'analyze.voice', prompt_version: 1, user_id }, { ... })` so it shows up in `/observability` like every other call.

3. **The voice prompt itself should be added to the registry** with `prompt_id: 'analyze.voice'`. That way it also appears in the Prompts tab, and users can suggest tweaks to how their voice gets analyzed (meta but useful).

4. **Recharts is already installed** — `package.json` has `recharts`. Don't `npm install` it again.

5. **Sent-folder access** needs the Nango Gmail scope that includes `https://www.googleapis.com/auth/gmail.readonly` (which covers sent). Should already be granted; if Nango rejects, the user needs to reconnect Gmail.

6. **The slop chart query is expensive** (full scan of items + item_feedback for 30d). Run `explain analyze` once locally; if it's >500ms, add an index on `items(user_id, created_at)`.

7. **Don't surface `prompt_suggestions` to the engineer via UI in this PR.** Just write to the table. A future `/admin/suggestions` page can list them. Add a `TODO(admin-ui)` comment in `suggestPromptEdit`.

8. **The Voice tab should gracefully handle never-run state.** If `communication_style IS NULL`, show empty state + a "Generate voice" button (same handler as Regenerate, different copy).

9. **Don't fetch sent emails on every page load.** Voice + examples are read from `users` columns. Only the Regenerate action makes the Nango call.

10. **Tabs URL sync** — use `useSearchParams` and `useRouter().replace()` to update `?tab=...` without a navigation. Don't trigger a full page reload.

---

## 15. One-paragraph TL;DR

> Build a 4-tab `/profile` page (Overview, Voice, Prompts, Stats). First rename "Soul" to "Voice" across the codebase, then extract all system prompts into `lib/prompt-registry.ts` so they're a single source of truth. Add two migrations: `users.voice_examples` + `users.voice_updated_at` (jsonb + timestamp), and a `prompt_suggestions` table. Overview shows identity, connections, and three quick-stat numbers. Voice shows the current learned communication style with extracted opener/closer examples plus a "Regenerate from last 30 days" button that runs a Claude call against the user's sent folder. Prompts shows each system prompt as an expandable card with its live slop rate; expanding reveals the full text plus a "Suggest a tweak" form that writes to `prompt_suggestions` for engineer review. Stats has three cleared-count cards (today/week/month), a Recharts line chart of slop rate per source over 30 days, and a single "top function this week" callout. All shadcn primitives already in the project except `Textarea` (one new file). Ship over 3 days: day 1 rename + registry + migration, day 2 page + Overview + Voice, day 3 Prompts + Stats. Test with `tsc --noEmit` and `npm run build` clean. No em-dashes anywhere.
