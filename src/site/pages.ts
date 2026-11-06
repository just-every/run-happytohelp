// Static source pages for rer. The router composes the approved homepage with
// current docs; its /run and /contract come directly from this build.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import Homepage from '../ui/homepage/Homepage'
import { DocsPage } from '../ui/docs/DocsPage'
import { buildSite } from '../ui/docs/build/site'
import { contractPageHtml } from './base/contract-page'
import { runPageHtml, siteNotFoundHtml, type SiteBuild, type SiteContext } from './base/run-site'
import { hostingPageHtml } from './base/hosting-page'
import { identity } from './identity'
import { run } from './run'

export function sitePages({ contract, hosting = null, styles = [] }: Partial<SiteContext> = {}): SiteBuild {
  const docs = buildSite(process.cwd())
  if (docs.problems.length) throw Error(docs.problems.join('\n'))
  const document = (body: string, title: string) => '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    + `<title>${title}</title>` + styles.map(href => `<link rel="stylesheet" href="${href}">`).join('') + '</head><body>' + body.replace(/href="\/(login|projects|setup|downloads(?:\/[^"]*)?)"/g, (_, path: string) => `href="https://happytohelp.com/${path}"`) + '</body></html>'
  return {
    pages: [
      { path: '/', html: document(renderToStaticMarkup(createElement(Homepage)), 'HappyToHelp — Customer Support, Solved.') },
      ...docs.pages.map(page => ({ path: page.href, html: document(renderToStaticMarkup(createElement(DocsPage, { page, sections: docs.sections, repository: docs.repository, version: 0 })), 'HappyToHelp docs') })),
      { path: '/run', html: runPageHtml(identity, run, contract) },
      { path: '/docs/hosting', html: hostingPageHtml(identity, run, hosting, contract) },
      ...(contract ? [{ path: '/contract', html: contractPageHtml(identity, run, contract) }] : []),
      { path: '/404', html: siteNotFoundHtml(identity, run, contract) },
    ],
    assets: ['rer-theme.css', 'fonts/fonts.css', 'fonts/outfit', 'homepage/media/brands'],
  }
}
