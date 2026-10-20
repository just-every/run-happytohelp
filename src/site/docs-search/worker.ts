import { search } from './retrieve';
import type { Embed, SearchIndex } from './types';

type Environment = { ASSETS: { fetch(request: Request): Promise<Response> }; AI: { run: Embed } };
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });

/** No app state, credentials or database. Install on the site's Worker only. */
export function createSearchWorker(index: SearchIndex, { endpoint = '/docs/search', minimumScore = 0.55 } = {}) {
  return {
    async fetch(request: Request, env: Environment): Promise<Response> {
      const url = new URL(request.url);
      if (url.hostname.startsWith('www.')) return Response.redirect(`https://${url.hostname.slice(4)}${url.pathname}${url.search}`, 301);
      if (url.pathname !== endpoint) return env.ASSETS.fetch(request);
      if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
      const query = (url.searchParams.get('q') ?? '').trim();
      if (query.length < 2) return json({ results: [] });
      if (query.length > 240) return json({ error: 'Query too long' }, 400);
      try {
        const vectors = await env.AI.run(index.model, { text: [`Represent this sentence for searching relevant passages: ${query}`], pooling: index.pooling });
        return json({ results: search(index, vectors.data[0], minimumScore) });
      } catch {
        return json({ error: 'Search unavailable' }, 503);
      }
    },
  };
}
