import { baseUrl, request } from './http'
import { comment, identity, providerError, record, text, timestamp, type Connection, type Issue, type IssueInput, type TicketLink } from './types'

function project(connection: Connection): string {
  if (!/^[A-Z][A-Z0-9_]*$/.test(connection.target)) throw providerError()
  return connection.target
}

function issueKey(key: string): string {
  if (!/^[A-Z][A-Z0-9_]*-[1-9]\d*$/.test(key)) throw providerError()
  return key
}

function document(body: string) {
  return { type: 'doc', version: 1, content: body.split('\n').map(line => ({
    type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [],
  })) }
}

export function jiraIssue(value: unknown, origin: string): Issue {
  const issue = record(value)
  const fields = record(issue.fields)
  const status = record(fields.status)
  const key = issueKey(text(issue.key))
  return {
    id: identity(issue.id), key, url: `${origin}/browse/${encodeURIComponent(key)}`,
    status: text(status.name), closed: record(status.statusCategory).key === 'done',
    assignee: fields.assignee == null ? null : text(record(fields.assignee).displayName),
    updatedAt: timestamp(fields.updated),
  }
}

export async function createJira(connection: Connection, input: IssueInput): Promise<Issue> {
  const created = record(await request(connection, '/rest/api/3/issue', { fields: {
    project: { key: project(connection) }, issuetype: { name: 'Task' },
    summary: input.title, description: document(input.body),
  } }))
  // Create returns only identity; read authoritative status instead of inventing it.
  return getJira(connection, text(created.key))
}

export async function getJira(connection: Connection, key: string): Promise<Issue> {
  const checked = issueKey(key)
  if (!checked.startsWith(`${project(connection)}-`)) throw providerError()
  const issue = jiraIssue(await request(connection, `/rest/api/3/issue/${encodeURIComponent(checked)}?fields=status,assignee,updated`), baseUrl(connection))
  if (issue.key !== key) throw providerError()
  return issue
}

export async function linkJira(connection: Connection, issue: Issue, link: TicketLink): Promise<void> {
  const key = issueKey(issue.key)
  if (!key.startsWith(`${project(connection)}-`)) throw providerError()
  const result = record(await request(connection, `/rest/api/3/issue/${encodeURIComponent(key)}/comment`, { body: document(comment(link)) }))
  identity(result.id)
}
