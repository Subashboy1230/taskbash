// Robust JSON extraction from an LLM response.
//
// Models sometimes ignore "return only JSON" instructions: they wrap the
// output in ```json fences, or add a prose explanation before or after the
// JSON. This pulls out just the JSON object so JSON.parse doesn't choke.
//
// Shared by every extractor (Granola, Gmail, Slack) so the parsing behaviour
// stays identical across sources.
export function extractJsonObject(text: string): string {
  // Drop any code fences, wherever they appear in the text.
  const noFences = text.replace(/```(?:json)?/gi, '')
  // Take from the first "{" to the last "}" — the bounds of the JSON object.
  const start = noFences.indexOf('{')
  const end = noFences.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return noFences.trim()
  return noFences.slice(start, end + 1)
}
