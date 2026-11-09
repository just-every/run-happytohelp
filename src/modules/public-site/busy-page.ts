import { escapeHtml as e } from './html'
import { shell } from './shell'

/**
 * The pages a browser gets while D1 is overloaded (platform/d1-overload.ts, app.ts). They read no D1, so no
 * workspace is known: HappyToHelp's own frame (as `missingHelpCenterPage`) and the Help Center stylesheets are
 * their look. They run no script, so the strictest page policies (portal, request and survey pages) allow them.
 */
export function busyFrame(title: string, content: string, head = '') {
 return shell({ name: 'HappyToHelp' }, '/', `<div class="help-center-busy">${content}</div>`, { search: false, title: `${title} · HappyToHelp`, noindex: true, platform: true })
  .replace('<script src="/site-assets/help_center/navigation.js" defer></script>', '')
  .replace('</head>', `${head}<link rel="stylesheet" href="/site-assets/help_center/busy.css"></head>`)
}

/** Headers for a busy page; `referrer` stays same-origin on a page whose form posts again, so the browser keeps the Origin the form handlers check. */
export function busyPageHeaders(retryAfter: number, referrer = 'strict-origin-when-cross-origin') {
 return { 'Retry-After': String(retryAfter), 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store, no-transform', 'X-Robots-Tag': 'noindex', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': referrer, Vary: 'Accept, Sec-Fetch-Mode' }
}

/** A page load refused by D1's overload: the page loads itself again after Retry-After. The wording stays neutral, because
 * the Worker entry's lookups also answer for application addresses such as /register. */
export function busyPage(retryAfter: number, again: string) {
 return busyFrame('Busy right now', `<h1>This page is busy right now</h1><p class="help-center-notice">Many requests are arriving at once. The page tries again by itself in ${retryAfter} seconds, or you can <a href="${e(again)}">try again now</a>.</p>`, `<meta http-equiv="refresh" content="${retryAfter}">`)
}
