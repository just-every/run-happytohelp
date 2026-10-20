import { randomUUID } from 'node:crypto';
import { startEdge, hmac, iso, notFound, issueSnapshot } from './edge.mjs';

// https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/
// https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-comments/
// https://developer.atlassian.com/cloud/jira/platform/webhooks/
export async function startJira() {
  // Jira's configured credential includes the authorization scheme.
  const token = 'Bearer synthetic-jira-token', secret = 'synthetic-jira-webhook-secret', target = 'SUP';
  let commentId = 20000;
  const edge = await startEdge({ token, authorization: token, secret, target,
    route({ method, path, json }, { issues }) {
      if (path === '/rest/api/3/issue' && method === 'POST') {
        const fields = json?.fields;
        if (fields?.project?.key !== target || !fields.summary || !fields.issuetype?.name)
          return { status: 400, body: { errorMessages: [], errors: { project: 'Invalid issue fields' } } };
        const number = issues.size + 1, id = String(10000 + number), key = `${target}-${number}`;
        const self = `https://synthetic.atlassian.net/rest/api/3/issue/${id}`;
        const now = iso();
        issues.set(key, { id, key, self, fields: { ...fields,
          created: now, updated: now, assignee: null,
          status: { id: '10000', name: 'To Do', statusCategory: { id: 2, key: 'new', name: 'To Do' } } } });
        return { status: 201, body: { id, key, self } };
      }
      const match = path.match(/^\/rest\/api\/3\/issue\/([^/]+)(\/comment)?$/);
      const issue = match && (issues.get(match[1]) ?? [...issues.values()].find(issue => issue.id === match[1]));
      if (!issue) return notFound();
      if (!match[2] && method === 'GET') return { body: issue };
      if (match[2] && method === 'POST') {
        if (json?.body?.type !== 'doc') return { status: 400, body: { errors: { body: 'ADF document required' } } };
        const id = String(++commentId);
        return { status: 201, body: { id, self: `${issue.self}/comment/${id}`, body: json.body,
          created: iso(), updated: iso(), author: { accountId: 'synthetic-bot', displayName: 'Support bot' } } };
      }
      return notFound();
    },
  });
  edge.webhook = (issue, options = {}) => {
    const snapshot = issueSnapshot(edge.issues, issue), deliveryId = options.deliveryId ?? randomUUID();
    snapshot.fields.updated = iso(options.updatedAt);
    if ('closed' in options) snapshot.fields.status = options.closed ?
      { id: '10002', name: 'Done', statusCategory: { id: 3, key: 'done', name: 'Done' } } :
      { id: '10001', name: 'In Progress', statusCategory: { id: 4, key: 'indeterminate', name: 'In Progress' } };
    if (options.status) snapshot.fields.status = typeof options.status === 'object' ? options.status :
      { ...snapshot.fields.status, name: options.status };
    if ('assignee' in options) snapshot.fields.assignee = options.assignee == null ? null :
      typeof options.assignee === 'object' ? options.assignee : { accountId: 'user-engineer', displayName: options.assignee };
    const body = JSON.stringify({ timestamp: new Date(options.sentAt ?? Date.now()).getTime(),
      webhookEvent: 'jira:issue_updated', issue_event_type_name: 'issue_updated', issue: snapshot,
      user: { accountId: 'user-engineer', displayName: 'Engineer', active: true },
      changelog: { id: '10000', items: [] } });
    return { body, headers: { 'content-type': 'application/json',
      'x-atlassian-webhook-identifier': deliveryId, 'x-hub-signature': `sha256=${hmac(secret, body)}` } };
  };
  return edge;
}
