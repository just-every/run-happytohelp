import { introGuardScript, introCss } from '../vendor/base/hydration/intro-guard';
import { CompiledVisualEdits } from '../editor/EditorLauncher';
import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router'
import NotFound from '../ui/homepage/NotFound'
import { TooltipLayer } from '../modules/tooltip/TooltipLayer'

// The HappyToHelp mark (src/ui/homepage/brand-mark.ts): the SVG for browsers that take one, the PNG rendered from it otherwise.
const brands = '/homepage/media/brands'
const favicons = [
  { rel: 'icon', type: 'image/png', sizes: '512x512', href: `${brands}/happytohelp-favicon.png` },
  { rel: 'icon', type: 'image/svg+xml', sizes: 'any', href: `${brands}/happytohelp-favicon.svg` },
  { rel: 'apple-touch-icon', sizes: '180x180', href: `${brands}/happytohelp-apple-touch-icon.png` },
]

export const Route = createRootRoute({
  head: ({ matches }) => {
    // The 404 document is a public page in the homepage language: it needs its own title, robots hint and font preload.
    if (matches.some(match => match.status === 'notFound' || match._notFound)) return {
      meta: [{ title: 'Page not found · HappyToHelp' }, { charSet: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1' }, { name: 'robots', content: 'noindex' }],
      links: [...favicons, { rel: 'preload', href: '/fonts/outfit/outfit-latin-wght-normal.woff2', as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' }],
    };
    return {
      meta: [{ title: 'HappyToHelp' }, { charSet: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1' }],
      title: 'HappyToHelp',
      links: favicons,
    };
  },
  notFoundComponent: NotFound,
  component: () => <html lang="en"><head><script dangerouslySetInnerHTML={{ __html: introGuardScript }} /><style>{introCss}</style><HeadContent /></head><body><CompiledVisualEdits /><TooltipLayer /><Outlet /><Scripts /></body></html>,
})
