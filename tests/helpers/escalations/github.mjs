import { randomUUID } from 'node:crypto';
import { startEdge, hmac, iso, notFound, issueSnapshot } from './edge.mjs';

// https://docs.github.com/en/rest/issues/issues#create-an-issue
// https://docs.github.com/en/rest/issues/comments#create-an-issue-comment
// https://docs.github.com/en/webhooks/webhook-events-and-payloads#issues
// https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
export async function startGitHub() {
  const token = 'synthetic-github-token', secret = 'synthetic-github-webhook-secret';
  const target = 'org/repo', repository = { id: 42, name: 'repo', full_name: target, owner: { login: 'org' } };
  let commentId = 1000;
  const edge = await startEdge({ token, authorization: `Bearer ${token}`, secret, target,
    route({ method, path, json }, { issues }) {
      if (path === `/repos/${target}/issues` && method === 'POST') {
        if (!json?.title) return { status: 422, body: { message: 'Validation Failed' } };
        const number = issues.size + 1, now = iso();
        const issue = { id: 10000 + number, node_id: `I_synthetic_${number}`, number,
          title: json.title, body: json.body ?? '', state: 'open', state_reason: null,
          assignee: null, assignees: [], labels: [], comments: 0,
          created_at: now, updated_at: now, closed_at: null,
          user: { id: 1, login: 'support-bot', type: 'Bot' },
          url: `https://api.github.com/repos/${target}/issues/${number}`,
          html_url: `https://github.com/${target}/issues/${number}` };
        issues.set(String(number), issue);
        return { status: 201, body: issue };
      }
      const match = path.match(/^\/repos\/org\/repo\/issues\/(\d+)(\/comments)?$/);
      const issue = match && issues.get(match[1]);
      if (!issue) return notFound();
      if (!match[2] && method === 'GET') return { body: issue };
      if (match[2] && method === 'POST') {
        if (typeof json?.body !== 'string') return { status: 422, body: { message: 'Validation Failed' } };
        const id = ++commentId;
        issue.comments++;
        return { status: 201, body: { id, body: json.body, created_at: iso(), updated_at: iso(),
          html_url: `${issue.html_url}#issuecomment-${id}`, user: issue.user } };
      }
      return notFound();
    },
  });
  edge.webhook = (issue, options = {}) => {
    const snapshot = issueSnapshot(edge.issues, issue), deliveryId = options.deliveryId ?? randomUUID();
    snapshot.updated_at = iso(options.updatedAt);
    if ('closed' in options) snapshot.state = options.closed ? 'closed' : 'open';
    if (options.status) snapshot.state = options.status;
    snapshot.closed_at = snapshot.state === 'closed' ? snapshot.updated_at : null;
    if ('assignee' in options) snapshot.assignee = options.assignee == null ? null :
      typeof options.assignee === 'object' ? options.assignee : { login: options.assignee, id: 2 };
    snapshot.assignees = snapshot.assignee ? [snapshot.assignee] : [];
    const body = JSON.stringify({ action: options.action ?? (snapshot.state === 'closed' ? 'closed' : 'edited'),
      issue: snapshot, repository, sender: { id: 2, login: 'engineer', type: 'User' } });
    return { body, headers: { 'content-type': 'application/json', 'x-github-event': 'issues',
      'x-github-delivery': deliveryId, 'x-hub-signature-256': `sha256=${hmac(secret, body)}` } };
  };
  return edge;
}
