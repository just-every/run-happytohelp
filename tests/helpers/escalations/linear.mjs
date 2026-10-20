import { randomUUID } from 'node:crypto';
import { startEdge, hmac, iso, notFound, issueSnapshot } from './edge.mjs';

// https://linear.app/developers/graphql (issueCreate, issue and commentCreate)
// https://linear.app/developers/webhooks (Issue updates and HMAC-SHA256)
export async function startLinear() {
  const token = 'synthetic-linear-token', secret = 'synthetic-linear-webhook-secret';
  const target = '72b2a2dc-6f4f-4423-9d34-24b5bd10634a';
  const edge = await startEdge({ token, authorization: token, secret, target,
    route({ method, path, json }, { issues }) {
      if (path !== '/graphql' || method !== 'POST') return notFound();
      const query = json?.query ?? '', variables = json?.variables ?? {};
      const input = variables.input ?? {};
      if (/\bissueCreate\s*\(/.test(query)) {
        if (input.teamId !== target || !input.title) return { body: { errors: [{ message: 'Invalid input' }] } };
        const number = issues.size + 1, id = randomUUID(), now = iso();
        const issue = { id, identifier: `SUP-${number}`, number, title: input.title,
          description: input.description ?? '', url: `https://linear.app/synthetic/issue/SUP-${number}`,
          createdAt: now, updatedAt: now, completedAt: null, canceledAt: null,
          team: { id: target, key: 'SUP', name: 'Support' }, teamId: target,
          state: { id: 'state-todo', name: 'Todo', type: 'unstarted' }, assignee: null };
        issues.set(id, issue);
        return { body: { data: { issueCreate: { success: true, issue } } } };
      }
      if (/\bcommentCreate\s*\(/.test(query)) {
        const issue = findIssue(issues, input.issueId);
        if (!issue || typeof input.body !== 'string') return { body: { errors: [{ message: 'Invalid comment input' }] } };
        return { body: { data: { commentCreate: { success: true,
          comment: { id: randomUUID(), body: input.body, issue: { id: issue.id }, createdAt: iso() } } } } };
      }
      if (/\bissue\s*\(/.test(query)) {
        const issue = findIssue(issues, variables.id);
        return issue ? { body: { data: { issue } } } : { body: { data: { issue: null }, errors: [{ message: 'Entity not found' }] } };
      }
      return { status: 400, body: { errors: [{ message: 'Unsupported GraphQL operation' }] } };
    },
  });
  edge.webhook = (issue, options = {}) => {
    const snapshot = issueSnapshot(edge.issues, issue), deliveryId = options.deliveryId ?? randomUUID();
    const sentAt = new Date(options.sentAt ?? Date.now()).getTime();
    snapshot.updatedAt = iso(options.updatedAt);
    if ('closed' in options) snapshot.state = options.closed ?
      { id: 'state-done', name: 'Done', type: 'completed' } : { id: 'state-progress', name: 'In Progress', type: 'started' };
    if (options.status) snapshot.state = typeof options.status === 'object' ? options.status :
      { id: 'state-custom', name: options.status, type: options.closed ? 'completed' : 'started' };
    snapshot.completedAt = snapshot.state.type === 'completed' ? snapshot.updatedAt : null;
    snapshot.canceledAt = snapshot.state.type === 'canceled' ? snapshot.updatedAt : null;
    if ('assignee' in options) snapshot.assignee = options.assignee == null ? null :
      typeof options.assignee === 'object' ? options.assignee : { id: 'user-engineer', name: options.assignee };
    const body = JSON.stringify({ action: 'update', type: 'Issue', data: snapshot,
      createdAt: snapshot.updatedAt, url: snapshot.url, organizationId: 'synthetic-organization',
      webhookTimestamp: sentAt, webhookId: 'synthetic-linear-webhook', updatedFrom: {},
      actor: { id: 'user-engineer', type: 'user', name: 'Engineer' } });
    return { body, headers: { 'content-type': 'application/json', 'linear-event': 'Issue',
      'linear-delivery': deliveryId, 'linear-timestamp': String(sentAt), 'linear-signature': hmac(secret, body) } };
  };
  return edge;
}

function findIssue(issues, id) {
  return issues.get(id) ?? [...issues.values()].find(issue => issue.identifier === id);
}
