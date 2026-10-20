import { request } from './http'
import { comment, identity, providerError, record, text, timestamp, type Connection, type Issue, type IssueInput, type TicketLink } from './types'

function repository(connection: Connection): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(connection.target) || ['.', '..'].includes(connection.target.split('/')[1])) throw providerError()
  return connection.target.split('/').map(encodeURIComponent).join('/')
}

function issueKey(key: string): string {
  if (!/^[1-9]\d*$/.test(key)) throw providerError()
  return key
}

export function githubIssue(value: unknown, target: string): Issue {
  const issue = record(value)
  if (issue.pull_request || !['open', 'closed'].includes(issue.state)) throw providerError()
  const key = issueKey(identity(issue.number))
  const repo = repository({ provider: 'github', target, token: '' })
  return {
    id: identity(issue.id), key, url: `https://github.com/${repo}/issues/${key}`,
    status: issue.state, closed: issue.state === 'closed',
    assignee: issue.assignee == null ? null : text(record(issue.assignee).login),
    updatedAt: timestamp(issue.updated_at),
  }
}

export async function createGithub(connection: Connection, input: IssueInput): Promise<Issue> {
  return githubIssue(await request(connection, `/repos/${repository(connection)}/issues`, { title: input.title, body: input.body }), connection.target)
}

export async function getGithub(connection: Connection, key: string): Promise<Issue> {
  const issue = githubIssue(await request(connection, `/repos/${repository(connection)}/issues/${issueKey(key)}`), connection.target)
  if (issue.key !== key) throw providerError()
  return issue
}

export async function linkGithub(connection: Connection, issue: Issue, link: TicketLink): Promise<void> {
  const result = record(await request(connection, `/repos/${repository(connection)}/issues/${issueKey(issue.key)}/comments`, { body: comment(link) }))
  identity(result.id)
}
