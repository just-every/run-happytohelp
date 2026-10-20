import { createGithub, getGithub, linkGithub } from './github'
import { createLinear, getLinear, linkLinear } from './linear'
import { createJira, getJira, linkJira } from './jira'
import { providerError, type Connection, type Issue, type IssueInput, type TicketLink } from './types'

export type { Tracker, Provider, Connection, Issue } from './types'
export { postSlack } from './slack'
export { verifyWebhook, parseWebhook } from './webhooks'

export async function createIssue(connection: Connection, input: IssueInput): Promise<Issue> {
  if (connection.provider === 'github') return createGithub(connection, input)
  if (connection.provider === 'linear') return createLinear(connection, input)
  if (connection.provider === 'jira') return createJira(connection, input)
  throw providerError()
}

export async function getIssue(connection: Connection, key: string): Promise<Issue> {
  if (connection.provider === 'github') return getGithub(connection, key)
  if (connection.provider === 'linear') return getLinear(connection, key)
  if (connection.provider === 'jira') return getJira(connection, key)
  throw providerError()
}

export async function addTicketLink(connection: Connection, issue: Issue, link: TicketLink): Promise<void> {
  if (connection.provider === 'github') return linkGithub(connection, issue, link)
  if (connection.provider === 'linear') return linkLinear(connection, issue, link)
  if (connection.provider === 'jira') return linkJira(connection, issue, link)
  throw providerError()
}
