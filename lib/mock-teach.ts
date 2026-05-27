// Mock data for the /teach prototype.
// Candidates = items the extractor has classified but isn't confident about.
// Suggested rules = patterns the system detected across many items.

import type { Source, Tag } from './types'

export interface TeachCandidate {
  id: string
  title: string
  source: Source
  source_pattern: string
  current_tag: Tag
  current_action: 'keep' | 'snooze' | 'dismiss'
  confidence: number
  age_days: number
  example_snippet: string
}

export interface SuggestedRule {
  id: string
  matched_count: number
  pattern: string
  source: Source
  proposed_action:
    | { kind: 'tag'; tag: NonNullable<Tag> }
    | { kind: 'dismiss' }
    | { kind: 'snooze'; hours: number }
    | { kind: 'route'; route: string }
  reasoning: string
}

export function getTeachCandidates(): TeachCandidate[] {
  return [
    {
      id: 't-1',
      title: 'Pilot questions on April expenses',
      source: 'gmail',
      source_pattern: 'pilot@pilot.com',
      current_tag: 'action',
      current_action: 'keep',
      confidence: 0.62,
      age_days: 14,
      example_snippet: 'We have 4 open questions on your April expenses…',
    },
    {
      id: 't-2',
      title: 'Pilot questions on March expenses',
      source: 'gmail',
      source_pattern: 'pilot@pilot.com',
      current_tag: 'action',
      current_action: 'keep',
      confidence: 0.58,
      age_days: 45,
      example_snippet: 'We have 6 open questions on your March expenses…',
    },
    {
      id: 't-3',
      title: 'LinkedIn weekly digest — your network is hiring',
      source: 'gmail',
      source_pattern: 'news@linkedin.com',
      current_tag: 'fyi',
      current_action: 'keep',
      confidence: 0.4,
      age_days: 1,
      example_snippet: '3 of your connections recently changed jobs…',
    },
    {
      id: 't-4',
      title: 'LinkedIn — 5 jobs that match your search',
      source: 'gmail',
      source_pattern: 'news@linkedin.com',
      current_tag: 'fyi',
      current_action: 'keep',
      confidence: 0.35,
      age_days: 8,
      example_snippet: 'Recommended for you based on your profile…',
    },
    {
      id: 't-5',
      title: 'Karim posted in #content',
      source: 'slack',
      source_pattern: '#content',
      current_tag: 'fyi',
      current_action: 'keep',
      confidence: 0.51,
      age_days: 2,
      example_snippet: 'A contrarian take on K-12 AI policy…',
    },
    {
      id: 't-6',
      title: 'Anna asked about Q3 OKRs',
      source: 'slack',
      source_pattern: 'DM: Anna Park',
      current_tag: 'reply',
      current_action: 'keep',
      confidence: 0.88,
      age_days: 4,
      example_snippet: 'Did you get a chance to look at the draft?',
    },
    {
      id: 't-7',
      title: 'Stripe receipt — $42.00',
      source: 'gmail',
      source_pattern: 'receipts@stripe.com',
      current_tag: 'fyi',
      current_action: 'keep',
      confidence: 0.3,
      age_days: 3,
      example_snippet: 'Your receipt from Stripe for May 24…',
    },
    {
      id: 't-8',
      title: 'Stripe receipt — $18.50',
      source: 'gmail',
      source_pattern: 'receipts@stripe.com',
      current_tag: 'fyi',
      current_action: 'keep',
      confidence: 0.3,
      age_days: 10,
      example_snippet: 'Your receipt from Stripe for May 17…',
    },
    {
      id: 't-9',
      title: 'May 18 — call with Matthew',
      source: 'granola',
      source_pattern: 'Granola transcripts',
      current_tag: 'commit',
      current_action: 'keep',
      confidence: 0.74,
      age_days: 9,
      example_snippet: 'Matthew committed to sending the spec by Monday…',
    },
  ]
}

export function getSuggestedRules(): SuggestedRule[] {
  return [
    {
      id: 'r-1',
      matched_count: 12,
      pattern: 'news@linkedin.com',
      source: 'gmail',
      proposed_action: { kind: 'dismiss' },
      reasoning:
        'You\'ve dismissed every item from this sender for 6 weeks. Always dismiss future ones?',
    },
    {
      id: 'r-2',
      matched_count: 8,
      pattern: 'receipts@stripe.com',
      source: 'gmail',
      proposed_action: { kind: 'route', route: 'Receipts' },
      reasoning:
        'These are receipts, not tasks. Route to a "Receipts" inbox instead of the digest.',
    },
    {
      id: 'r-3',
      matched_count: 5,
      pattern: 'pilot@pilot.com',
      source: 'gmail',
      proposed_action: { kind: 'tag', tag: 'action' },
      reasoning:
        'You always treat Pilot emails as action items. Lock in the tag so the extractor stops guessing.',
    },
    {
      id: 'r-4',
      matched_count: 4,
      pattern: '#content channel',
      source: 'slack',
      proposed_action: { kind: 'tag', tag: 'fyi' },
      reasoning:
        'Posts here are usually informational and you rarely act on them. Tag as FYI by default.',
    },
  ]
}
