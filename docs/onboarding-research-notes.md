# Onboarding research notes (May 2026)

Source material for the onboarding PRD. These are the patterns the spec leans on, in case Cursor wants to verify "why is this opinionated."

---

## Headline findings

| Finding | Source | How it shows up in our PRD |
|---|---|---|
| Time-to-first-value should be under 5 minutes; first aha within 2 min | Chameleon | Aim Screen 6 (extraction) completes in 60-90s |
| Role/use-case personalization lifts activation 30-50% | Userpilot | Screens 2 + 3 + role-driven function seeding |
| Interactive walkthroughs beat static tutorials for retention | Appcues | Screen 7 = clickable tour, not a video |
| 4-step checklist users are 3x more likely to convert | Appcues | Screen 8 has a 3-item "What happens next" checklist |
| Notion avoids the blank workspace by pre-populating templates | UXcam | Empty-state insurance via demo tasks if no connections |
| Linear's flow is multi-column, keyboard-friendly, polished animation | Pageflows | Our flow is full-page, animated counter, 200ms transitions |
| Superhuman ships white-glove 1:1 onboarding | Pageflows | Not v1, but is a future tier for paid plans |
| Progressive disclosure: hide complexity until users demonstrate readiness | Userpilot | We don't show Snooze, Slop, or Functions until Screen 7+ |
| Activation rate benchmark: 40% bad, 40-60% normal, 60%+ excellent | Artisan | Our target: >60% |

---

## Patterns we explicitly chose

**Linear-style multi-step horizontal flow.** Full-page, one decision per screen, dot-progress indicator, snappy transitions. Avoids modal claustrophobia and gives each step room to breathe.

**Notion-style pre-population.** Empty workspace kills retention. If user connects no sources, we seed three convincing demo tasks. The aha moment ("oh, my screen has my work in it") still lands.

**Superhuman-style white-glove copy.** Direct, conversational, never patronizing. "Let's wire up your inbox" not "Connect your account." "Your AI chief of staff" not "Productivity tool."

**Nummo-style task row in tour.** Bold imperative title + synthesized 1-2 sentence subtitle + status pill on the right. Modeled exactly on the screenshots Subash shared.

---

## Patterns we explicitly rejected

**Welcome video.** Adds 60-90 seconds with no interaction. Read-watch-then-act is dead. Show the product, don't narrate it.

**"Take a tour" optional modal.** Optional tours have 5-15% completion. Forced (but fast) flow has 60-80%. Force the value moment.

**Multi-tab onboarding (Notion/Settings/Inbox).** Splits attention. We have one screen at a time.

**Progress percentage like "30% complete".** Demotivating early ("only 30%??"). We use dot pills + "Step 3 of 8" which feels more navigable.

**Confetti / sound effects.** Cheap dopamine. The dark theme + restrained palette signals "this is a serious tool." Confetti would undercut the brand.

**A required walkthrough of every feature.** Show one feature deeply (Screen 7 = the task row), let the rest be discovered. Power users learn by exploring, not by being shown.

---

## Activation metric instrumentation

Insert into `agent_events` on each onboarding milestone so we can measure:

| Event kind | Payload | Why we track it |
|---|---|---|
| `onboarding.started` | `{ user_id }` | Denominator |
| `onboarding.step_completed` | `{ step, time_on_step_ms }` | Find where users drop |
| `onboarding.gmail_connected` | `{ }` | First commitment |
| `onboarding.extraction_completed` | `{ duration_ms, item_count }` | Aha moment timing |
| `onboarding.completed` | `{ total_duration_ms, sources_connected: string[] }` | Activation |

After we have 50+ completions, query:
- Completion rate = completed / started
- Median time-to-aha = median of `extraction_completed.duration_ms` + time to get there
- Drop-off by step = step_completed counts per step
- Source mix = distribution of `sources_connected` arrays

---

## Sources

- [12 Apps with Great User Onboarding (2026 Examples) — UXcam](https://uxcam.com/blog/10-apps-with-great-user-onboarding/)
- [26 User Onboarding Examples Worth Stealing in 2026 — Appcues](https://www.appcues.com/blog/best-user-onboarding-examples)
- [Linear Onboarding Flow on Web — Pageflows](https://pageflows.com/post/desktop-web/onboarding/linear/)
- [Superhuman Desktop Onboarding — Pageflows](https://pageflows.com/post/desktop-web/onboarding/superhuman/)
- [How to find your product's Aha moment — Chameleon](https://www.chameleon.io/blog/successful-user-onboarding)
- [Aha Moment Guide for Product Managers — Userpilot](https://userpilot.com/blog/aha-moment/)
- [User Activation Rate: Find and Fix Your SaaS Aha Moment — Artisan](https://www.artisangrowthstrategies.com/blog/user-activation-rate-find-fix-saas-aha-moment)
- [SaaS Onboarding Flow: 10 Best Practices That Reduce Churn — DesignRevision](https://designrevision.com/blog/saas-onboarding-best-practices)
