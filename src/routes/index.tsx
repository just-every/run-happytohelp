import { createFileRoute, redirect } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { withVisualEdits } from '../editor/VisualEditBoundary';
import Homepage from '../ui/homepage/Homepage';
const rootDestination = createServerFn({ method: 'GET' }).handler(async () => {
  const { installationRootDestination } = await import('../platform/root-entry.server');
  return installationRootDestination();
});
export const Route = createFileRoute('/')({
  headers: () => ({ 'Cache-Control': 'no-store', Vary: 'Cookie, Authorization' }),
  beforeLoad: async ({ location }): Promise<void> => {
    const destination = await rootDestination();
    if (!destination) return;
    const incoming = new URLSearchParams(location.searchStr), query = new URLSearchParams();
    // Each destination receives only the parameters its existing page accepts.
    const accepted = destination === '/login' ? ['returnTo'] : ['locale', 'keyword', 'q', 'access', 'sent'];
    for (const key of accepted) {
      const value = incoming.get(key);
      if (value !== null) query.set(key, value);
    }
    throw redirect({ href: destination + (query.size ? `?${query}` : ''), statusCode: 302,
      headers: { 'Cache-Control': 'no-store', Vary: 'Cookie, Authorization' } });
  },
  head: () => ({
    meta: [
      { title: 'HappyToHelp — Customer Support, Solved.' },
      { name: 'description', content: 'Customer support, solved. Your Codex or Claude fixes the problem and writes the reply; you press Send. Chat widget, shared inbox, help centre and suggested replies. Open source alternative to Zendesk, Intercom, Help Scout and Freshdesk. MIT licensed.' },
    ],
    links: [{ rel: 'preload', href: '/fonts/outfit/outfit-latin-wght-normal.woff2', as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' }],
  }),
  component: withVisualEdits(Homepage),
});
