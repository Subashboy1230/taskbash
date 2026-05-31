import { config } from 'dotenv'
config({ path: '.env.local' })

async function main() {
  const { getActiveConnection } = await import('../lib/connections')
  const conn = await getActiveConnection('linear')
  if (!conn?.api_key) { console.log('no linear conn'); process.exit(1) }

  const QA_STATE_NAMES = ['QA Requested', 'Changes Requested', 'In QA', 'QA Passed', 'QA passed']

  const query = `
    query QAIssues {
      issues(
        first: 50
        filter: { state: { name: { in: ["QA Requested", "Changes Requested", "In QA", "QA Passed", "QA passed"] } } }
        orderBy: updatedAt
      ) {
        nodes {
          id
          identifier
          title
          state { name type }
          team { key name }
          assignee { name email }
          priority
          dueDate
          updatedAt
        }
      }
    }
  `
  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: conn.api_key },
    body: JSON.stringify({ query }),
  })
  const data = await res.json() as any
  const issues = data.data?.issues?.nodes ?? []
  console.log(`Issues in QA states: ${issues.length}`)
  for (const i of issues) {
    console.log(` [${i.state?.name}] ${i.identifier} ${i.title} — ${i.team?.name} — assignee: ${i.assignee?.name ?? 'none'}`)
  }
  if (data.errors) console.log('errors:', data.errors)
}
main().catch(console.error)
