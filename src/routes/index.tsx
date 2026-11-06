import { createFileRoute } from '@tanstack/react-router';
import { withVisualEdits } from '../editor/VisualEditBoundary';
import Homepage from '../ui/homepage/Homepage';
export const Route = createFileRoute('/')({
  head: () => ({
    meta: [
      { title: 'HappyToHelp — Customer Support, Solved.' },
      { name: 'description', content: 'Customer support, solved. Your Codex or Claude fixes the problem and writes the reply; you press Send. Chat widget, shared inbox, help centre and suggested replies. Open source alternative to Zendesk, Intercom, Help Scout and Freshdesk. MIT licensed.' },
    ],
    links: [{ rel: 'preload', href: '/fonts/outfit/outfit-latin-wght-normal.woff2', as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' }],
  }),
  component: withVisualEdits(Homepage),
});
