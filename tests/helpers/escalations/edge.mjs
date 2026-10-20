import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';

// Only the external network edge is synthetic. Application routes, persistence,
// provider adapters and signature verification run unchanged in the journeys.
export async function startEdge({ token, authorization, secret, target, route }) {
  const received = [], responses = [], issues = new Map();
  const edge = { token, secret, target, received, responses, issues, baseUrl: '', authorizations: new Set([authorization]) };
  const server = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString('utf8');
      const headers = { ...req.headers };
      const authenticated = edge.authorizations.has(req.headers.authorization);
      // Captures are safe to include in diagnostics: no authorization value is kept.
      if ('authorization' in headers) headers.authorization = '[redacted]';
      const url = new URL(req.url, edge.baseUrl);
      const json = body && headers['content-type']?.includes('application/json') ? JSON.parse(body) : null;
      const record = { method: req.method, url: url.href, path: url.pathname, headers, body, json, authenticated };
      received.push(record);
      if (!authenticated) return send(res, { status: 401, body: { message: 'Unauthorized' } });
      // Each injected response is consumed once, allowing uncertain HTTP 500,
      // explicit rejection, rate limits and a dropped connection to be exercised.
      if (responses.length) {
        const response = responses.shift();
        if (response.disconnect) return req.socket.destroy();
        return send(res, response);
      }
      send(res, await route({ ...record, url }, edge));
    } catch (error) {
      send(res, { status: 400, body: { message: error.message } });
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  edge.baseUrl = `http://127.0.0.1:${server.address().port}`;
  edge.close = () => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeIdleConnections();
  });
  return edge;
}

function send(res, { status = 200, body = {}, headers = {} } = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(text);
}

export const hmac = (secret, body) => createHmac('sha256', secret).update(body).digest('hex');
export const iso = (value = Date.now()) => new Date(value).toISOString();
export const notFound = () => ({ status: 404, body: { message: 'Not found' } });

// webhook() builds a snapshot and never rewrites the remote record: a late event
// must not silently roll provider state back. Set issues.get(key) fields explicitly
// when a journey also wants a later authenticated provider read to see the update.
export function issueSnapshot(issues, issue) {
  const value = typeof issue === 'object' && issue !== null ? issue : issues.get(String(issue));
  if (!value) throw new Error('Unknown synthetic provider issue');
  return structuredClone(value);
}
