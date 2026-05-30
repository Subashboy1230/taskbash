# Nummo audit + ToDoo redesign proposal

Wrote this after clicking through every Nummo surface end-to-end. The point isn't "copy Nummo." Nummo's UX rests on a particular product thesis about what an AI chief of staff *is* — once that thesis is named, the right UI for ToDoo falls out.

---

## 1. What Nummo actually is, in one sentence

**Nummo is an approval queue, not a task list.** Every "task" is something the agent already drafted; the user's job is to approve, modify, or reject — not to do.

That's the whole core. The product is built so the operator never types an email; they triage replies the agent wrote. Everything else (calendar strip, completed-today, settings) sits around that loop.

This is a sharper thesis than ToDoo's. ToDoo today is "morning digest of items you need to do." Nummo is "morning queue of decisions the agent needs from you to act on your behalf."

---

## 2. The patterns worth borrowing

### Surface architecture

- **Top bar** — minimal: ToDoo wordmark + 3 right-side icons (memories / notifications / avatar). Nothing else. No nav rail.
- **Today** is one page: calendar strip → active section → completed-today (collapsed).
- **Detail panel** opens on the right when you click a task. Same page, no navigation.
- **Full task detail** is a separate page when you need it (breadcrumb `Tasks / Approval Queue / [item]`) — for power use, longer content.
- **Settings** is a separate /settings page with a left rail (Profile, Team, Soul, Workflows, Connections, Network, Notifications, API Keys, Activity, Billing). Sign-out lives here, not in the avatar dropdown.

### The task row

- Title (bold) + one-line description (truncated, grey) + right-side status ("Drafted a reply", "Access needed tomorrow") + due-time chip.
- Selected row has a colored left bar + soft-tinted background.
- On hover: **X (reject) + ✓ (approve) micro-buttons appear inside the row** — speed triage without opening the panel.

### The detail panel (right side)

- Header: minimize-panel icon (left) + edit + history icons (right).
- "Reply drafted for you" badge + "View full task details →" link (top of panel, jumps to dedicated page).
- **Description** in plain English (what the agent thinks happened + what it did).
- The artifact itself **inline**: the email draft is shown as a card with EMAIL · Reply · Draft tabs, Edit button, Subject/To, body.
- **Two big buttons**: "Delete Draft" (outline) + "Send Email" (green, primary, plane icon).
- "Not ready to complete this task? Remind me later" — soft escape.
- **Agent log below**: "Task: X. Completed N fulfilled; triaged M inbound (...). Proposed actions: gmail_send: ... What would you like to do? You can approve, reject, ask me to modify, or tell me more context."
- "Ask Nummo anything…" chat input at the bottom.

The most important detail: **the panel shows the actual email the agent will send if you hit Approve.** It's not a description of an email; it's the email. Send Email actually sends it.

### Full task detail page

- Breadcrumb at top — `Tasks / Approval Queue / [item]`.
- Title + status pill (`● Awaiting Approval`, `● Done`, `● Rejected`).
- **3 prominent header actions**: Snooze (clock) / Reject Task / Approve & Send (green primary).
- Tabs: **Details** | **Context Trail**.
- Details = description + email draft + agent log.
- **Context Trail = provenance**. "Showing how this task was assembled." Source filter dropdown. Each source rendered as a card showing the actual raw content (the email thread, the meeting transcript, the Slack message). This is what makes the system trustworthy — the user can audit *why* the agent decided to draft this.
- Right rail: DETAILS (Type: Approval Review / Auto-completed, Created: 1h ago).
- Prev/Next arrows (← →) on completed items to flip through.
- Chat input persistent at bottom.

### Completed view

- Page title: **"What's been handled"** + "Tasks completed for you."
- Grouped by date with collapsible sections.
- Each row: title + preview + status pill (Approved / Rejected / Done) + timestamp.
- Click a completed item → opens the same detail page with Done state.

### Settings — the deep stuff

- **Soul** — a stored, human-readable profile of the user's communication style. Real example from this account: *"You write in a direct, concise, professional style. Your emails are usually short and action-oriented … You open with 'Hi [Name]' and close with 'Best regards'…"* Plus formatting habits, working preferences. This is what makes drafts sound like Subash.
- **Workflows** — scheduled or triggered agent jobs (Pre-Call Brief, Meeting Briefs, Message Follow-ups, Daily Tasks, Inbox Follow-ups). Each has a trigger (`On upcoming meeting` / `Every 5 minutes` / custom). Toggle on/off. "Explore More" library of installable workflows (Recruiter, Dreamer, etc.). Categories: Briefs / Follow-ups / Tasks / Other.
- **Network** — an auto-built CRM (598 companies, 1485 people in this account). Columns: Stage, Status, Last Touch, Signal (green bar for new), Tasks count. Extracted from email/calendar/meeting data, no user input.
- **Connections** — same idea as ours but with stats per source (Records, Today, Last Sync) and per-source "Sync now" + (for Drive) "Browse files". Slack splits into "Connect Workspace" vs "Connect Personal" — solves the bot-user mess we hit.
- **Activity** — single audit log of "everything Nummo has done." Tabs: All / Agent Runs / Tasks / Data Sources / Approvals / Records. Each row: timestamp + source icon (or status pill) + title + right-side status (Synced / In Review / Rejected).

### Memories (brain icon top-right)

- Side drawer. Header "Memories N".
- Tabs: General / Company / People.
- Searchable list of facts.
- **"+ Add Memory"** primary button at bottom.
- One of the Workflows is called **"Dreamer"** — *"Overnight reflection pass. Tidies state (expired auth, decayed memories) and writes back preference memories learned from the day's decisions."* So memories are both user-added and agent-learned.

### Notifications (bell icon)

- Side drawer. Header "Notifications 8". Tabs: All / Unread / Read.
- Stream of agent activity ("Post-Call Brief: X" with preview + timestamp).
- It's *not* a real "ping me" system — it's a log of what the agent produced.

### Chat input (persistent at bottom of every page)

- "Ask Nummo anything…" + microphone + "+" (attach? new task?) + send arrow.
- On a task page: scoped to that task (you can say "make it shorter", "add a line about pricing").
- On Today: scoped to general agent dialogue.

This is the always-available interaction surface. The user can always *talk back* to the agent.

---

## 3. ToDoo's gap vs. Nummo — what we're missing

Listed in order of leverage:

1. **No approval queue model.** ToDoo treats items as "things you need to do." Nummo treats them as "things the agent did, ready for you to approve." Massive difference — Nummo never makes you write an email. Ours always does.

2. **No artifact in the row.** Ours shows title + brief. Nummo shows you the actual draft. You can approve from the panel without thinking "what did the agent want me to send?"

3. **No "Send" button that actually sends.** Approve & Send is the killer feature. Our `completeItem` just marks it done — nothing leaves the app.

4. **No Context Trail.** Without seeing the source email/transcript, the user has no way to verify the agent's interpretation. We pass `parent_context` as a string but never show the underlying material.

5. **No Soul.** Our drafts (when we have them — only briefs so far) use generic prompts. We don't have a learned voice profile that makes drafts sound like the user.

6. **No Workflows surface.** Our morning-digest is a single hardcoded cron. Nummo lets the user enable/disable/configure individual workflows and install new ones from a library.

7. **No Network/CRM.** Each item in ours is orphan — we don't link to a stakeholder or thread the same way.

8. **No Activity log.** Our `agent_events` table exists; nothing renders it. Users can't audit what the agent has done.

9. **No Memories.** Agent has no persistent knowledge surface.

10. **Hover-triage micro-buttons missing.** We have row-level actions in the action buttons block but they don't appear on hover — they're tied to selection. Nummo's are faster.

---

## 4. Proposal — what to build, in order

Ranked by **leverage / effort**. None of this requires throwing out what we have; we layer.

### Tier 1 — core thesis change (this is what makes it Nummo-class)

**A. Adopt the approval-queue model for at least one task type.**
Concretely: when the Gmail extractor pulls a "reply owed" item, also pre-draft the reply using Claude + Soul prompt, and store it as `proposed_action: { kind: 'gmail_send', subject, to, body }`. The row shows "Drafted a reply" (we already have this label). Clicking the row opens a detail panel with the draft inline. **"Send Email" actually sends via Gmail API.**

Schema add:
- `items.proposed_action jsonb` — null when no action proposed.
- `items.task_type` already exists; add `'approval_review' | 'auto_completed'` to the enum (or repurpose `review`).

UI:
- Detail panel renders the draft.
- Approve & Send button calls a new server action `executeProposedAction(itemId)` that runs the action then marks completed.
- Reject Task → marks dismissed.
- Snooze → existing.

This is the single biggest feature lift. Everything else compounds on top.

**B. Add Context Trail tab on task detail.**
We have `parent_context` as a string and `source_ref` with IDs. Add a third field `source_excerpt text` populated by the extractor with the actual content (raw email body, transcript excerpt). Render in a new tab on the detail page: source icon + title + excerpt card. This is what makes the system auditable.

**C. Soul.**
Create `users.communication_style text` (large markdown). Build a one-time analyzer that reads the user's last 50 sent emails (via Gmail) and writes a Soul profile. Use it as the system prompt for any drafting (briefs, replies). Add a Settings → Soul page that shows the current style and lets the user edit it.

### Tier 2 — surface polish that matches Nummo's flow

**D. Hover-triage on rows.**
Add X / ✓ micro-buttons that appear on row hover (left side, not right) for one-click reject/approve. Existing detail-panel actions still work.

**E. "What's been handled" page (history).**
Currently we have "Completed today" collapsed at the bottom of Today. Move to a dedicated `/handled` page with date grouping, accessible via avatar dropdown or a tab on /today. Each row clickable → opens detail in Done state.

**F. Status pills consistently.**
Adopt Nummo's vocabulary: `● Awaiting Approval` (orange) / `● Done` (green) / `● Rejected` (red) / `● Auto-completed` (grey). Use everywhere.

**G. Persistent chat input.**
Bottom-of-page "Ask ToDoo anything…" input. Scoped to the current view. On a task page → talk about the task ("make it shorter"). On Today → general questions. Sends to Claude with appropriate context.

### Tier 3 — settings depth

**H. Workflows page.**
Show our current jobs (morning-digest, backfill-briefs, etc.) as toggleable workflows. Even better: split morning-digest into separate workflows per source, each toggleable. Add a workflow library later.

**I. Activity page.**
Render `agent_events` table as a chronological feed. Tabs for All / Runs / Tasks / Extracts.

**J. Connections — record counts + sync now.**
Augment our connection cards with Records / Today / Last Sync stats. Add per-source "Sync now" that triggers a single-source extract via a new Inngest event.

### Tier 4 — bigger bets

**K. Network (auto-CRM).**
Extract `stakeholders` table from all source data — every From/To email, every meeting attendee, every Slack DM partner. Link items to stakeholders. Render at /network with last-touch / signal columns. Long-term differentiator.

**L. Memories.**
Add `memories` table (kind, text, links). Add brain icon → drawer pattern. Build a "Dreamer" workflow that runs nightly to extract recurring patterns into memories.

---

## 5. My recommendation — what to ship this week

Skip Tier 2/3/4 for now. Do **A + B + C** in that order.

- **A (approval queue for Gmail replies)**: ~2 days. Schema migration, extractor change, new server action `executeProposedAction`, UI update on detail panel.
- **B (Context Trail tab)**: ~half a day. Schema add, render in detail page.
- **C (Soul, lightweight)**: ~half a day. Just create the field, write a one-time analyzer script, plug into the brief + draft prompts. The Settings page UI can come later.

Total: ~3 days of focused work to turn ToDoo from "morning digest" into "morning approval queue." That's the thesis change. After that we can iterate on polish.

The rest (D-L) we do in subsequent weeks, picking from the recommendation order based on what feedback says hurts most.

---

## 6. What I deliberately wouldn't copy

- **Multiple tabs and pages everywhere** — Nummo's settings have 10 sub-pages. We don't need that depth yet. Keep ours minimal until we have features that warrant it.
- **The persistent chat input on every page** — until we have something useful for the chat to do (modify the draft, answer about the source), it's just noise. Add when there's substance.
- **The orange-purple gradient calendar** — we have it already and it's a Nummo cliche. Differentiating later is fine.
- **The Dreamer-style nightly memory reflection** — clever but premature; users have to ship value first before the system can introspect.
