import { request } from './http'
import { comment, identity, providerError, record, text, timestamp, type Connection, type Issue, type IssueInput, type TicketLink } from './types'

const fields = 'id identifier url updatedAt completedAt canceledAt state { name type } assignee { name }'

async function graphql(connection: Connection, query: string, variables: unknown): Promise<Record<string, any>> {
  const result = record(await request(connection, '/graphql', { query, variables }))
  if (result.errors != null && (!Array.isArray(result.errors) || result.errors.length)) throw providerError()
  return record(result.data)
}

export function linearIssue(value: unknown, eventUrl?: unknown): Issue {
  const issue = record(value)
  let url: URL
  try { url = new URL(text(issue.url ?? eventUrl)) } catch { throw providerError() }
  if (url.protocol !== 'https:' || url.hostname !== 'linear.app' || url.port || url.username || url.password) throw providerError()
  // Data-change events can omit computed GraphQL fields; the documented event
  // URL still identifies the issue. State is reconciled through issue(id: UUID).
  const key = text(issue.identifier ?? url.pathname.match(/\/issue\/([A-Za-z][A-Za-z0-9_]*-\d+)(?:\/|$)/)?.[1])
  if (!/^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(key)) throw providerError()
  const state = issue.state == null ? null : record(issue.state)
  return {
    id: identity(issue.id), key, url: url.href,
    status: state ? text(state.name) : 'unknown',
    assignee: issue.assignee == null ? null : text(record(issue.assignee).name),
    closed: state?.type === 'completed' || state?.type === 'canceled' || !!issue.completedAt || !!issue.canceledAt,
    updatedAt: timestamp(issue.updatedAt),
  }
}

export async function createLinear(connection: Connection, input: IssueInput): Promise<Issue> {
  const data = await graphql(connection, `mutation CreateSupportIssue($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { ${fields} } } }`, {
    input: { teamId: text(connection.target), title: input.title, description: input.body },
  })
  const result = record(data.issueCreate)
  if (result.success !== true) throw providerError()
  return linearIssue(result.issue)
}

export async function getLinear(connection: Connection, key: string): Promise<Issue> {
  const data = await graphql(connection, `query SupportIssue($id: String!) { issue(id: $id) { ${fields} } }`, { id: text(key) })
  const issue = linearIssue(data.issue)
  if (issue.id !== key && issue.key.toLowerCase() !== key.toLowerCase()) throw providerError()
  return issue
}

export async function linkLinear(connection: Connection, issue: Issue, link: TicketLink): Promise<void> {
  const data = await graphql(connection, 'mutation LinkSupportTicket($input: CommentCreateInput!) { commentCreate(input: $input) { success comment { id } } }', {
    input: { issueId: text(issue.id), body: comment(link) },
  })
  const result = record(data.commentCreate)
  if (result.success !== true) throw providerError()
  identity(record(result.comment).id)
}
