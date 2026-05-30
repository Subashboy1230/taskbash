// Brief generation — the differentiator.
//
// A "brief" is the synthesized context that turns a one-line task into
// something actionable in 30 seconds. Structure: Why / Know / Done / Next.
// Full design rationale: docs/brief-spec.md
//
// The ONE rule: synthesis, not retrieval. The brief tells the user what the
// source material MEANS for this task — not what it says.

import { anthropic, MODELS } from './anthropic'
import { tracedMessage } from './llm-trace'

export interface TaskBrief {
  why: string          // one sentence — what triggered this task
  know: string[]       // 2-4 bullets — synthesized context, each one interprets
  done: string         // one sentence — concrete success criteria
  next: string         // one sentence — the literal next action
}

export interface GenerateBriefArgs {
  title: string
  parentContext: string | null
  source: string
  tag: string | null
  // Raw source material to synthesize from (e.g. Granola summary + transcript).
  // The richer this is, the better the brief.
  sourceContent?: string
}

const SYSTEM_PROMPT = `You write the "brief" for a chief-of-staff task. The synthesized context that turns a one-line task into something the user can act on in 30 seconds without opening another tab.

THE ONE RULE: synthesis, not retrieval. Tell the user what the source material MEANS for this task, not what it says.
- Retrieval (bad): "The meeting mentioned the deck three times."
- Synthesis (good): "The deck is the blocker on the partnership. It's come up every meeting and nothing has moved."

Output STRICT JSON. No markdown fences, no prose outside the JSON object.

Schema:
{
  "why": "one sentence: what triggered this task and why it is on the list",
  "know": ["2 to 4 bullets of synthesized context. Each one interprets, never just recites"],
  "done": "one sentence: concrete success criteria. What 'complete' actually looks like",
  "next": "one sentence: the literal next action. Not 'follow up', the actual move"
}

Rules:
- Every sentence must advance a decision. If a sentence only describes, cut it.
- Be specific: names, dates, dollar amounts, direct phrasing. Never "recently". Say the date if you have it.
- No hedging ("it seems", "potentially", "might be"). If genuinely uncertain, state it once, plainly.
- Do NOT restate the task title. The user already read it.
- "know": 2 to 4 bullets, each one sentence, each doing real interpretive work. No bullet that just summarizes the meeting.
- If the source material is thin and you genuinely cannot synthesize much, keep "know" short and honest rather than padding it.
- Sound like a sharp chief of staff briefing their principal: direct, specific, decision-oriented. Not like an AI generating a report.

STYLE RULE (absolute): NEVER use em-dashes (—) anywhere in the output. Use a
regular hyphen with spaces ( - ), a colon, a comma, a period, or rewrite the
sentence. Every field (why, know bullets, done, next) must be em-dash free.`

export async function generateBrief(args: GenerateBriefArgs): Promise<TaskBrief> {
  const prompt = buildPrompt(args)

  const response = await tracedMessage(
    anthropic,
    {
      prompt_id: 'brief.synthesize',
      prompt_version: 1,
      user_id: process.env.APP_USER_ID ?? null,
    },
    {
      model: MODELS.synthesis, // Sonnet — quality matters here, this is the moat
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    }
  )

  const text = response.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map(b => b.text)
    .join('')

  return parseBrief(text)
}

function buildPrompt(args: GenerateBriefArgs): string {
  const parts = [
    `Task: ${args.title}`,
    `Source: ${args.source}`,
    args.tag ? `Tag: ${args.tag}` : null,
    args.parentContext ? `Context: ${args.parentContext}` : null,
  ].filter(Boolean)

  let prompt = parts.join('\n')

  if (args.sourceContent && args.sourceContent.trim()) {
    // Cap source content so the prompt stays bounded on cost
    const capped = args.sourceContent.slice(0, 8000)
    prompt += `\n\nSource material to synthesize from:\n${capped}`
  } else {
    prompt +=
      '\n\n(No source material available — synthesize what you can from the task and context alone, and keep "know" honest about the thin context.)'
  }

  prompt += '\n\nWrite the brief as STRICT JSON.'
  return prompt
}

function parseBrief(text: string): TaskBrief {
  let parsed: Partial<TaskBrief>
  try {
    const cleaned = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')
    parsed = JSON.parse(cleaned)
  } catch (err) {
    console.error('[brief] failed to parse Claude response:', text.slice(0, 200))
    // Return a minimal valid brief so the caller doesn't crash
    return {
      why: 'Could not generate a brief for this task.',
      know: [],
      done: 'Review the task manually.',
      next: 'Open the source to see full context.',
    }
  }

  return {
    why: typeof parsed.why === 'string' ? parsed.why : '',
    know: Array.isArray(parsed.know) ? parsed.know.filter(k => typeof k === 'string') : [],
    done: typeof parsed.done === 'string' ? parsed.done : '',
    next: typeof parsed.next === 'string' ? parsed.next : '',
  }
}
