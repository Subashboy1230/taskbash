// Generate a synthesized description + concrete subtasks for a task.
// Uses Haiku (fast + cheap) since this runs on every detail panel open.
//
// Returns:
//   description — 1-2 sentence synthesis of what this task is and why it matters.
//   subtasks    — 2-4 concrete, actionable steps to complete the task.

import { anthropic, MODELS } from '../anthropic'
import { tracedMessage } from '../llm-trace'
import { extractJsonObject } from '../extract/parse'

export interface TaskDetails {
  description: string
  subtasks: string[]
}

const SYSTEM_PROMPT = `You generate a short task description and concrete subtasks for a chief-of-staff task manager.

Output STRICT JSON only. No prose, no markdown fences:
{
  "description": "string. 1-2 sentences: what this task is and why it matters right now. Specific, not generic.",
  "subtasks": ["step 1", "step 2", "step 3"]
}

Rules for description:
- Synthesize: explain what the task MEANS, not just what it says.
- Be specific: include names, amounts, deadlines if present in the source.
- Do NOT restate the task title. Add context the title doesn't have.

Rules for subtasks:
- 2 to 4 subtasks only. Each one is a concrete, completable action.
- Start each with a verb: "Write...", "Send...", "Review...", "Find...", "Schedule..."
- Under 10 words each. No vague steps like "Follow up" or "Handle this".
- If the task is simple and doesn't need subtasks, return 2 simple steps max.

STYLE RULE (absolute): NEVER use em-dashes (—). Use hyphens, colons, or rewrite.`

export async function generateTaskDetails(args: {
  title: string
  parentContext: string | null
  source: string
  tag: string | null
  sourceExcerpt?: string | null
  userId?: string | null
}): Promise<TaskDetails> {
  const parts = [
    `Task: ${args.title}`,
    `Source: ${args.source}`,
    args.tag ? `Tag: ${args.tag}` : null,
    args.parentContext ? `Context: ${args.parentContext}` : null,
  ].filter(Boolean)

  let prompt = parts.join('\n')

  if (args.sourceExcerpt?.trim()) {
    prompt += `\n\nSource material:\n${args.sourceExcerpt.slice(0, 3000)}`
  } else {
    prompt += '\n\n(No source material available - synthesize from the task and context alone.)'
  }

  prompt += '\n\nGenerate the task description and subtasks as STRICT JSON.'

  const response = await tracedMessage(
    anthropic,
    {
      prompt_id: 'task.details',
      prompt_version: 1,
      user_id: args.userId ?? null,
    },
    {
      model: MODELS.classifier,
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    }
  )

  const text = response.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map(b => b.text)
    .join('')

  try {
    const parsed = JSON.parse(extractJsonObject(text)) as Partial<TaskDetails>
    return {
      description: typeof parsed.description === 'string' ? parsed.description : '',
      subtasks: Array.isArray(parsed.subtasks)
        ? parsed.subtasks.filter(s => typeof s === 'string').slice(0, 4)
        : [],
    }
  } catch {
    return { description: '', subtasks: [] }
  }
}
