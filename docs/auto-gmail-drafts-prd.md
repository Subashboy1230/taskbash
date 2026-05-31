# PRD: auto-create Gmail drafts for genuine incoming emails

Hand to Claude in Cursor. Self-contained — pairs with `CLAUDE.md`.

Status: spec. Builds on existing `lib/draft/reply.ts`, `proposed_action` field, and the Gmail send path. Adds two new pieces: actually materialize the draft as a real Gmail Draft API row, and tighten what counts as "draftable."

---

## 1. Goal

Every incoming email that genuinely needs Subash's reply gets a draft pre-written *and* saved to his Gmail Drafts folder, automatically, in the same extraction pass. Marketing, newsletters, receipts, calendar invites, and other automated noise produce **no draft at all**.

Two surfaces for the same draft:

- **In taskbash** — the task row shows "Draft ready" pill; clicking the task opens the detail panel with the draft body editable; clicking Send dispatches via Gmail.
- **In Gmail.com** — the same draft sits in his Drafts folder, threaded under the original conversation. If he opens Gmail directly he sees the AI-written reply ready to edit + send from the native client.

If he sends from Gmail, taskbash detects that on the next polling cycle and marks the task done. If he sends from taskbash, the Gmail draft converts to a sent message in-place via `users.drafts.send`. Either way: same draft, same thread, no duplicates.

---

## 2. Why this matters

Currently `lib/draft/reply.ts` writes a draft into `items.proposed_action`. The draft lives in taskbash's DB only. The user has to open taskbash to see it. **Two failure modes**:

1. User reads the email in Gmail mobile, types a reply by hand, never opens taskbash that day. The pre-drafted reply is wasted work.
2. User opens taskbash, sees the draft, but the draft is mediocre. He'd edit it, but the editor in the detail panel is rudimentary compared to Gmail's compose window.

Materializing the draft as a real Gmail Draft removes both:

1. The draft is wherever the user reads email. No app-switching required.
2. He can use Gmail's full compose UI to edit (autocomplete addresses, attach files, format, schedule send) before sending.

The trade-off: more Gmail API calls (one `drafts.create` per genuine reply), and the user's Drafts folder fills up if he doesn't act on them. Mitigated by §11 (auto-cleanup of stale drafts after 14 days).

---

## 3. User flow

### Before this PRD

```
Gmail receives email → taskbash extracts → tag='reply' → draftReply()
  → saves to items.proposed_action.body
  → "Draft ready" pill on row
  → user clicks Send in taskbash → users.messages.send → email goes out
```

The draft never leaves taskbash's DB.

### After this PRD

```
Gmail receives email → taskbash extracts → tag='reply'
  → genuineness gate (§7)
  → if genuine:
       draftReply() builds body
       buildRecipients() computes To/Cc (§6)
       createGmailDraft() POSTs to users.drafts.create
       saves draft_id back to items.proposed_action.gmail_draft_id
  → if not genuine: skip drafting entirely, no pill, item still listed
       as a "reply needed" task but with no auto-action
```

### Send flow (from taskbash)

User clicks Send → `sendDraft()` server action → `users.drafts.send` with the saved `gmail_draft_id` → the draft converts to a sent message in the original thread → item.status='completed', item.reply_outcome='approved'.

### Send flow (from Gmail directly)

User opens Gmail Drafts, edits, hits Send → the Gmail draft is gone (now a sent message) → next gmail-poll cycle detects the sent message via thread_id + sender=self → item.status='completed', item.reply_outcome='approved'. No duplicate task.

### Dismiss flow

User clicks Slop or Dismiss in taskbash → `dismissItem()` → `users.drafts.delete` removes the draft from Gmail → item.status='dismissed', item.reply_outcome='rejected'.

---

## 4. Genuineness gate

Don't draft for noise. Three layers, applied in order:

**Layer 1 — Hard skip on category headers.** Skip threads where Gmail's category is `promotions`, `social`, `forums`, or `updates`. The existing query already does this (`-category:promotions -category:social`); extend to also exclude `-category:forums -category:updates`.

**Layer 2 — Sender-domain blocklist.** Maintain a `gmail_draft_blocklist` table per user with sender emails or domains the user has explicitly opted out of. Right-click any task row → "Never draft for sender@x.com." Adds a row. Drafting checks the blocklist before generating.

**Layer 3 — AI-tier genuineness score.** The Gmail extractor already filters newsletters in the prompt. Tighten it: add a new field to the extraction output schema:

```json
{
  "title": "...",
  "tag": "reply",
  "draft_confidence": "high" | "medium" | "low" | "skip"
}
```

- `high` — definitely a real one-to-one human exchange, draft confidently
- `medium` — likely real but borderline (cold outreach, recruiter), draft but include a warning chip
- `low` — sketchy, draft skipped, just a task row
- `skip` — clearly automated despite slipping through Layer 1, no task at all

Only draft when `draft_confidence='high'` OR (`draft_confidence='medium'` AND user has the "draft borderline replies" setting on, default off).

The classifier reasoning lives in the prompt — examples cover: VIP investor email = high, "Hi Subash, your $99 Cold Email Stack is ready" = skip, recruiter reaching out for a role = medium, etc.

---

## 5. Schema changes

### 5.1 `migrations/025_gmail_draft_ids.sql`

```sql
-- The Gmail draft_id this item materialized as. Null when no draft was
-- generated (non-reply task, low confidence, blocklisted sender, or
-- the user disabled auto-drafts).
alter table items add column gmail_draft_id text;
alter table items add column draft_confidence text;
   -- 'high' | 'medium' | 'low' | 'skip'

create index items_gmail_draft_idx on items(gmail_draft_id)
  where gmail_draft_id is not null;

comment on column items.gmail_draft_id is
  'Gmail Draft resource id. Used by sendDraft() via drafts.send and by dismiss to delete.';
comment on column items.draft_confidence is
  'Extractor-emitted confidence the email warranted a pre-written reply.';
```

### 5.2 `migrations/026_gmail_draft_blocklist.sql`

```sql
create table gmail_draft_blocklist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  pattern text not null,           -- email address, *@domain.com, or full domain
  pattern_kind text not null,      -- 'email' | 'domain'
  added_from_item_id uuid references items(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (user_id, pattern)
);

create index gmail_draft_blocklist_user_idx on gmail_draft_blocklist(user_id);

alter table gmail_draft_blocklist enable row level security;
create policy "users manage own blocklist"
  on gmail_draft_blocklist for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

### 5.3 `migrations/027_auto_draft_settings.sql`

```sql
-- Per-user preference for auto-draft behavior. Default ON for new users.
alter table users add column auto_draft_enabled boolean default true;
alter table users add column auto_draft_borderline boolean default false;
   -- whether to draft for confidence='medium' replies

comment on column users.auto_draft_enabled is
  'Whether the agent should pre-create Gmail drafts on extraction.';
comment on column users.auto_draft_borderline is
  'When true, also drafts for borderline (medium-confidence) replies.';
```

---

## 6. Recipient logic — `buildRecipients()`

New function in `lib/draft/reply.ts`. Inputs: the thread, the user's email. Output:

```ts
interface RecipientPlan {
  to: string[]            // who the reply goes to
  cc: string[]            // who else stays on the thread
  in_reply_to: string     // gmail_message_id of the message being replied to
  references: string[]    // full References chain for proper threading
  subject: string         // 'Re: ...' if not already prefixed
}
```

**Rules:**

1. **`to`** — the `From` address of the most recent message in the thread that wasn't sent by the user. Single address.
2. **`cc`** — every distinct address that appeared in `To` or `Cc` of the latest non-user message, MINUS:
   - The user's own email (so we don't cc ourselves)
   - Anyone already in `to`
   - Anyone in the `gmail_draft_blocklist`
3. **`in_reply_to`** — the `Message-ID` header of the email being replied to. Already in the thread payload.
4. **`references`** — the existing `References` header from the thread's latest message + the `Message-ID` being replied to, in order. Gmail uses this for threading; getting it wrong creates a new thread instead of continuing the existing one.
5. **`subject`** — if the latest subject already starts with `Re:` (case-insensitive), use as-is. Otherwise prepend `Re: `.

**Edge cases:**

- If the latest message was sent by the user, walk backward in the thread to find the most recent NON-user message and reply to that one. (Handles "I sent something, they haven't responded yet, but I want to follow up.")
- If everyone in the thread is in the blocklist, skip drafting entirely.
- If the thread has only the user in `to`/`cc` lists (a private note to self), don't draft.

---

## 7. New Gmail Drafts API integration

New file: `lib/gmail/drafts.ts`.

### 7.1 `createGmailDraft(args)`

```ts
export async function createGmailDraft(args: {
  userId: string
  threadId: string                // gmail_thread_id from extraction
  inReplyTo: string               // Message-ID being replied to
  references: string[]
  to: string[]
  cc: string[]
  subject: string
  body: string                    // plain text; we don't ship HTML drafts in v1
}): Promise<{ draftId: string }> {
  const conn = await getActiveConnection('gmail')
  if (!conn?.nango_connection_id) throw new Error('Gmail not connected')

  const mime = buildMime({
    from: args.fromEmail,
    to: args.to,
    cc: args.cc,
    subject: args.subject,
    inReplyTo: args.inReplyTo,
    references: args.references,
    body: args.body,
  })
  const raw = base64UrlEncode(mime)

  const response = await nangoProxy<{ id: string }>({
    providerConfigKey: NANGO_PROVIDER_KEY.gmail!,
    connectionId: conn.nango_connection_id,
    method: 'POST',
    endpoint: '/gmail/v1/users/me/drafts',
    body: { message: { raw, threadId: args.threadId } },
  })

  return { draftId: response.id }
}
```

### 7.2 `updateGmailDraft(args)` and `deleteGmailDraft(draftId)`

Used when user edits the draft body in taskbash (sync to Gmail) or marks slop (clean up the orphan draft).

### 7.3 `sendGmailDraft(draftId)`

Wraps `POST /gmail/v1/users/me/drafts/send` with `{ id: draftId }`. Returns the sent message id. Server action `sendDraft()` calls this when it has a `gmail_draft_id`, falls back to current `messages.send` path when it doesn't (for back-compat with older items).

### 7.4 MIME construction

```ts
function buildMime(opts: BuildMimeOpts): string {
  const lines = [
    `From: ${opts.from}`,
    `To: ${opts.to.join(', ')}`,
    ...(opts.cc.length > 0 ? [`Cc: ${opts.cc.join(', ')}`] : []),
    `Subject: ${opts.subject}`,
    `In-Reply-To: <${opts.inReplyTo}>`,
    `References: ${opts.references.map(r => `<${r}>`).join(' ')}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    opts.body,
  ]
  return lines.join('\r\n')
}
```

Standard RFC 5322 / Gmail-compatible. CRLF line endings matter.

---

## 8. Integration into the extractor

`lib/extract/gmail.ts` already produces `ExtractedItem[]` per thread. After the per-thread `extractItemsFromThread()` call, add this block:

```ts
for (const item of items) {
  if (item.tag !== 'reply') continue
  if (!shouldAutoDraft(item, user.auto_draft_enabled, user.auto_draft_borderline)) continue

  const draft = await draftReply({ ... })  // existing call
  item.proposed_action = draft

  if (await isInBlocklist(user.id, latestSender)) continue

  const plan = buildRecipients(thread, user.email)
  const { draftId } = await createGmailDraft({
    userId: user.id,
    threadId: thread.id,
    inReplyTo: plan.in_reply_to,
    references: plan.references,
    to: plan.to,
    cc: plan.cc,
    subject: plan.subject,
    body: draft.body,
  })
  item.proposed_action.gmail_draft_id = draftId
}
```

`shouldAutoDraft` checks: confidence level + user settings. Returns false on `confidence='low'` or `'skip'`, true on `'high'`, conditional on `'medium'`.

---

## 9. UI changes

### 9.1 Task row

When `item.gmail_draft_id` exists, the "Draft ready" pill (existing) gets a tiny Gmail icon prefix. Tooltip on hover: "Saved to Gmail Drafts." Optional: link to open the draft directly in Gmail (`https://mail.google.com/mail/u/0/#drafts/${draftId}`).

### 9.2 Detail panel

The draft body textarea is unchanged. On save (debounced 1s), call `updateGmailDraft(draftId, newBody)` server action to sync. Show a small "Synced to Gmail" indicator next to the textarea.

### 9.3 Send button behavior

Already exists. Just changes the underlying call from `messages.send` to `drafts.send` when `gmail_draft_id` is present.

### 9.4 New right-click menu item

On any Gmail-sourced row, right-click → "Never draft for sender@x.com." Writes to `gmail_draft_blocklist`. Also offers "Never draft for *@x.com" if the sender's domain has produced ≥3 drafted tasks in the last 30 days.

### 9.5 Profile page settings

In the Voice tab (or a new Drafts subsection): two toggles.

- **Auto-create Gmail drafts** (default on) — when on, every high-confidence reply task generates a Gmail draft. When off, drafts only live in taskbash.
- **Also draft borderline replies** (default off) — when on, medium-confidence threads also get drafts. Useful for sales/cold-email-heavy workflows.

A small list at the bottom: "Senders you've blocked from auto-draft (N)" with a remove button per row.

---

## 10. Lifecycle hooks

Where `gmail_draft_id` matters in existing actions:

| Action | Current behavior | After this PRD |
|---|---|---|
| `sendDraft(itemId)` | `users.messages.send` with proposed_action body | If `gmail_draft_id` exists → `users.drafts.send(draftId)`; else → existing path |
| `markItemSlop(itemId)` | status='dismissed', writes item_feedback | Also calls `deleteGmailDraft(draftId)` so the orphan draft doesn't sit in Gmail forever |
| `dismissItem(itemId)` | status='dismissed' | Also calls `deleteGmailDraft(draftId)` |
| `completeItem(itemId)` without send | status='completed' | Leaves the draft in Gmail (user dealt with it elsewhere — maybe they sent it from Gmail) |
| Save edit to draft body in taskbash | writes to proposed_action.body | Also calls `updateGmailDraft(draftId, newBody)` |
| `gmail-poll` detects a sent message in a tracked thread | (new) | Marks the item completed with reply_outcome='approved', removes any pending draft_id (already sent, draft is gone) |

---

## 11. Stale draft cleanup

If a task with `gmail_draft_id` sits open for more than 14 days, an Inngest cron deletes the Gmail draft to avoid cluttering the user's Drafts folder, but leaves the task open. Adds a small `Draft expired` pill (gray) so the user knows the saved draft is gone but the task is still there.

```ts
// inngest/functions/draft-cleanup.ts
export const draftCleanup = inngest.createFunction(
  { id: 'draft-cleanup', name: 'Draft cleanup' },
  [{ cron: '0 4 * * *' }],   // daily at 4 AM UTC
  async ({ step }) => {
    const stale = await step.run('find-stale', async () => {
      const { data } = await supabase
        .from('items')
        .select('id, gmail_draft_id, user_id')
        .not('gmail_draft_id', 'is', null)
        .eq('status', 'open')
        .lt('created_at', new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString())
      return data ?? []
    })
    for (const row of stale) {
      await step.run(`del-${row.id}`, async () => {
        await deleteGmailDraft(row.user_id, row.gmail_draft_id)
        await supabase
          .from('items')
          .update({ gmail_draft_id: null, draft_expired_at: new Date().toISOString() })
          .eq('id', row.id)
      })
    }
  }
)
```

Adds another column: `items.draft_expired_at timestamptz`.

---

## 12. Cost + rate-limit considerations

**Gmail API quotas:** each `drafts.create` counts as 5 quota units against the user's 250-per-second cap. With 30 threads per digest run, that's 150 units — well under the limit but worth monitoring.

**Anthropic cost:** the genuineness classifier adds zero tokens (it's part of the existing extraction prompt, just an extra output field). No new Claude call.

**Nango call volume:** one extra `drafts.create` per genuine reply, currently ~5-10/day per user. Negligible.

If the volume grows: batch `drafts.create` calls via Gmail's `batch` endpoint to amortize the per-request overhead.

---

## 13. Failure modes + handling

| Failure | Handling |
|---|---|
| `drafts.create` returns 403 (scope missing) | The Nango Gmail integration needs `gmail.compose` or `gmail.modify` scope. Verify in the Nango dashboard; if missing, user re-auths Gmail. Item still gets a draft in `proposed_action` (DB only), just no Gmail draft. |
| `drafts.create` returns 429 (rate limit) | Retry with exponential backoff (2s, 4s, 8s). If still fails, fall back to DB-only draft. |
| User edits the draft in Gmail while taskbash also tries to update | Gmail wins (last write). Add a debounced 5s "settle" before taskbash auto-syncs from local edits. |
| `drafts.send` returns 404 (draft was already deleted) | Fall back to `messages.send` with the saved body. User probably deleted from Gmail. Mark `gmail_draft_id=null` and proceed. |
| Thread has 100+ messages and References header is huge | Truncate `references` to the first 20 message ids (RFC 5322 doesn't strictly cap, but some MTAs reject very long headers). |

---

## 14. Acceptance criteria

The PRD is implemented correctly when:

- [ ] Migrations 025 + 026 + 027 applied
- [ ] `lib/gmail/drafts.ts` exports `createGmailDraft`, `updateGmailDraft`, `deleteGmailDraft`, `sendGmailDraft`
- [ ] Gmail extractor emits `draft_confidence` per reply item
- [ ] When `draft_confidence='high'` AND user has auto_draft_enabled AND sender not blocklisted → a Gmail draft is created and the draft_id stored on the item
- [ ] The draft appears in the user's actual Gmail Drafts folder, threaded under the original conversation
- [ ] Clicking Send in taskbash dispatches via `drafts.send` and the message ships
- [ ] Editing the draft body in taskbash syncs to Gmail within 2 seconds of stopping typing
- [ ] Marking slop or dismissing the task deletes the Gmail draft
- [ ] Sending from Gmail directly (without taskbash) is detected on next poll and marks the item completed
- [ ] Blocklist UI works: right-click sender → never-draft → no future drafts for that sender
- [ ] Profile settings: auto_draft_enabled and auto_draft_borderline persist + take effect immediately
- [ ] Stale draft cleanup runs daily and removes drafts older than 14d
- [ ] `tsc --noEmit` and `npm run build` clean
- [ ] No em-dashes anywhere

---

## 15. Ship order (3 days)

### Day 1 — Plumbing
- Apply migrations 025-027
- Build `lib/gmail/drafts.ts` (create / update / delete / send + MIME builder)
- Verify with a manual server-action test: insert a fake item, call `createGmailDraft`, open Gmail to verify it appears

### Day 2 — Extractor integration + send path
- Update Gmail extractor prompt with `draft_confidence` field + examples
- Wire `createGmailDraft` into `extract/gmail.ts` after `draftReply`
- Update `sendDraft` server action to prefer `drafts.send` when `gmail_draft_id` exists
- Update `markItemSlop`, `dismissItem` to call `deleteGmailDraft`

### Day 3 — UI + settings + cleanup cron
- Right-click "Never draft for sender" menu item
- Profile settings toggles
- `inngest/functions/draft-cleanup.ts` cron
- End-to-end test: real email comes in → draft appears in Gmail → send from taskbash → email ships → task closes

---

## 16. Future work

- HTML formatted drafts (currently plain text only)
- Schedule send via Gmail's native scheduled-send (already in `drafts.send` API, just need a UI date picker)
- Cc taskbash itself on outgoing drafts as a way to verify what actually shipped vs. what was drafted
- Voice-aware regeneration: "this draft sounds wrong, regenerate" button calls `draftReply` again and updates the Gmail draft in place

---

## 17. Gotchas

1. **The Nango Gmail provider needs `gmail.modify` scope.** Drafts create/send require it. Verify in the Nango dashboard before shipping. Users will need to re-auth if scope is added after they already connected.

2. **Threading is fragile.** Get the `References` header wrong and Gmail starts a new thread next to the original. Test on a real multi-message thread before claiming the feature works.

3. **`drafts.send` consumes the draft.** Once it's sent, the draft is gone — no longer in Drafts folder, exists only as a sent message. Don't keep `gmail_draft_id` around as if it's still valid after send; null it out.

4. **MIME body must be base64url, not base64.** Subtle but breaks the API call. Use the existing `Buffer.from(mime).toString('base64').replace(/\+/g, '-').replace(/\//g, '_')` pattern.

5. **Don't auto-draft for the user's own outbound emails.** The Block C "commitments from sent folder" feature creates items with `tag='commit'`, not `tag='reply'`. The auto-draft logic only triggers on `tag='reply'`, so this is already safe — but worth a code-comment.

6. **Threading edge case: Gmail merges threads aggressively.** If two unrelated emails happen to share a subject line ("Re: Q3 OKRs"), Gmail will sometimes thread them together in the inbox view but keep them separate in the API. Use `threadId` explicitly when creating the draft to avoid Gmail re-threading our draft into the wrong conversation.

7. **The settings page already has tabs (Overview / Voice / Prompts / Stats).** Add the auto-draft toggles to a new "Drafts" sub-section inside the Voice tab — don't add a new top-level tab.

8. **Em-dash ban applies to all UI copy and to the draft_confidence prompt examples.**

---

## 18. One-paragraph TL;DR

> When the Gmail extractor finds a genuine incoming reply needed (not marketing, not a newsletter, not a blocklisted sender), it auto-creates a Gmail draft via `users.drafts.create` with proper threading headers — and stores the `draft_id` on the item. The draft appears in both taskbash AND the user's actual Gmail Drafts folder. Sending from taskbash uses `users.drafts.send` to convert the draft to a sent message in place, preserving thread continuity. Sending from Gmail directly is detected on next poll and closes the task. Dismissing or marking slop deletes the orphan draft from Gmail. A "Never draft for sender" right-click menu writes to a per-user blocklist. Settings toggle controls whether auto-drafts run at all + whether borderline (medium-confidence) replies get drafts. Three new migrations: items.gmail_draft_id + draft_confidence, gmail_draft_blocklist table, users.auto_draft_enabled/auto_draft_borderline. New file lib/gmail/drafts.ts wraps the four Gmail Drafts API endpoints. Stale drafts auto-cleanup after 14 days via a small Inngest cron. Three-day build. Acceptance in §14. No em-dashes.
