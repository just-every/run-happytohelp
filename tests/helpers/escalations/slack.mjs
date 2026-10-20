import { randomUUID } from 'node:crypto';
import { startEdge, hmac, notFound } from './edge.mjs';

// https://docs.slack.dev/reference/methods/chat.postMessage/
// https://docs.slack.dev/reference/methods/chat.getPermalink/
// https://docs.slack.dev/authentication/verifying-requests-from-slack/
export async function startSlack() {
  const token = 'xoxb-synthetic-slack-token', secret = 'synthetic-slack-signing-secret', target = 'C0123456789';
  let sequence = 0;
  const edge = await startEdge({ token, authorization: `Bearer ${token}`, secret, target,
    route({ method, path, json, body, url }, { issues }) {
      const params = json ?? Object.fromEntries(new URLSearchParams(body));
      if (path === '/api/chat.postMessage' && method === 'POST') {
        if (![target, 'C12345678'].includes(params.channel)) return { body: { ok: false, error: 'channel_not_found' } };
        if (typeof params.text !== 'string') return { body: { ok: false, error: 'no_text' } };
        const ts = `${Math.floor(Date.now() / 1000)}.${String(++sequence).padStart(6, '0')}`;
        const message = { type: 'message', subtype: 'bot_message', user: 'U0123456789', bot_id: 'B0123456789',
          text: params.text, ts, ...(params.thread_ts ? { thread_ts: params.thread_ts } : {}) };
        issues.set(ts, { ...message, channel: params.channel });
        return { body: { ok: true, channel: params.channel, ts, message } };
      }
      if (path === '/api/chat.getPermalink' && (method === 'GET' || method === 'POST')) {
        const channel = url.searchParams.get('channel') ?? params.channel;
        const ts = url.searchParams.get('message_ts') ?? params.message_ts;
        if (issues.get(ts)?.channel !== channel) return { body: { ok: false, error: 'message_not_found' } };
        return { body: { ok: true, permalink: `https://synthetic.slack.com/archives/${channel}/p${ts.replace('.', '')}` } };
      }
      return notFound();
    },
  });
  edge.messages = edge.issues;
  edge.webhook = (message, options = {}) => {
    const event = typeof message === 'object' ? structuredClone(message) : structuredClone(edge.messages.get(String(message)));
    if (!event) throw new Error('Unknown synthetic Slack message');
    const timestamp = String(Math.floor(new Date(options.sentAt ?? Date.now()).getTime() / 1000));
    const body = JSON.stringify({ type: 'event_callback', team_id: 'T0123456789', api_app_id: 'A0123456789',
      event_id: options.deliveryId ?? randomUUID(), event_time: Number(timestamp), event: { ...event, event_ts: event.ts } });
    return { body, headers: { 'content-type': 'application/json', 'x-slack-request-timestamp': timestamp,
      'x-slack-signature': `v0=${hmac(secret, `v0:${timestamp}:${body}`)}` } };
  };
  return edge;
}
