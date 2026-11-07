# Public homepage and Help Center

The public homepage is a native TanStack Start/React route in `src/routes/index.tsx`,
composed from `src/ui/homepage` (inline drawings and the inline HappyToHelp mark and drawn
wordmark, no raster images). The mark's SVG and favicon files, and the PNGs rendered from them, are in
`public/homepage/media/brands`.
It retains links to native workspace, setup and login. This module serves dynamic,
project-scoped published help centers. Former pricing, resources, legal, waitlist,
referrer-personalized and public homepage-widget behavior remains retired. The
customer support widget remains an independent owner-configured product surface
served from its own `/widget.js` build.

`index.ts` dispatches the canonical help-center routes; `/` belongs to the native
React router.
`help-center.tsx` preserves `/{project}/search?keyword=...`,
`/{project}/{article_slug}` and `/help/{project}` aliases. Only persisted project
IDs or explicitly granted slugs resolve. Project owners/admins can claim an
unused slug via PUT `/api/public-site/projects/:projectId/alias`; reserved app
paths cannot be claimed. `docs` is reserved, so no alias can shadow the
documentation at `/docs`; an alias named `docs` from before the reservation stays
reachable at `/help/docs`. Published project-scoped articles are rendered with the
maintained Markdown renderer (raw HTML disabled), and draft/deleted projects stay
private. Legacy slug import is assigned to migration round 5 and is not available
today. Until it lands, an authenticated project owner/admin must set each retained
slug by sending `PUT /api/public-site/projects/:projectId/alias` with
`Content-Type: application/json` and body `{"slug":"retained-help-slug"}` using
their native session. This writes `public_project_aliases`; there is currently no
dashboard control for aliases. Legacy `/{slug}/` links resolve only after that
alias exists.

Help that only an import filled stays out of search indexes. A workspace is
import-only when it has published articles, every one of them came from an import (Move in,
the legacy importer or the Article import page's Intercom and Freshdesk import, which records
`knowledge_import_origins` from this release; earlier API imports keep no per-article record and
stay indexable) and no member has published in it. Every public help page of such a workspace, on
every path, alias and configured host, carries `X-Robots-Tag: noindex` and a robots `noindex` meta
tag, with the same status, body and caching. When a member publishes or republishes an article
(editor, proposal or rollback) the workspace is indexable again and a later import does not
reverse that. `import-noindex.ts` holds the one query. There is no sitemap or `robots.txt` rule
for help paths, because a Disallow would hide the `noindex` from crawlers.

`help-host.ts` also serves the legacy host-root forms `/`, `/search?keyword=...`
and `/{article_slug}` when deployment explicitly supplies `PUBLIC_HELP_HOSTS` as
JSON mapping exact lowercase hostnames to retained project slugs or native IDs.
The map has no default hosts: it does not derive a hostname from a slug, trust
forwarding headers or use the editable custom-domain setting as proof of domain
ownership. Unknown or deleted projects and draft articles retain the same publication
fences as path-based centers. The application hostname in `APP_ORIGIN` is
excluded, so its homepage and `/run` retain their existing handlers. Hostnames
are compared with the request URL hostname (no scheme, port, path, wildcard or
suffix matching); a port does not define a separate host. Only GET/HEAD root,
search and single article paths are eligible; reserved application and API paths
retain their normal handlers. The server calls `publicHelpHostResponse` after
static assets and before application dispatch, applying the ordinary public-site
security/document headers to a returned response. This source change configures
no real domains and performs no DNS or TLS work.

Not-found responses are HTML with HTTP 404 inside the Help Center frame
(`shell.ts`, `not-found.ts`), never an unstyled plain-text response. A known project with a missing or
unpublished article gets the project's header and search with "Article not found"; the
body depends only on the project, so a draft cannot be told from an article that never
existed. An unknown or deleted project, or an address no route serves (such as
`/help/a/b/c`), gets the same frame as HappyToHelp's own page: HappyToHelp's mark,
drawn wordmark and tab icons (`platform-brand.ts`) and no search box. Project pages
never carry HappyToHelp's brand; they show the project's own name, logo and colour. Paths under
`/api/public-site/` keep the plain 404. Unknown application paths outside the Help Center
render the branded application 404 described in `docs/NAVIGATION.md`.

Knowledge provider imports (Intercom, Freshdesk and Zendesk) remain in the
knowledge capability and write only through its scoped, durable import jobs.
They are independent of the public homepage. Authenticated owner/admin site
previews use the site-preview capability and its separate origin; retired public
demo/trial creation is not part of this module.

No public route initializes an operator token, widget secret or tracking ID.
Missing configuration returns an explicit unavailable state. The Help Center
shell uses the first-party stylesheet at
`public/site-assets/help_center/css/app.css`; the original service's theme and
pattern files are not included. See `docs/PUBLIC-SOURCE-PROVENANCE.md` for asset
provenance and licences.

`tests/journeys/public.mjs`,
`pnpm run test:public-help-center-browser`, `pnpm run test:not-found-browser` and
`tests/journeys/public-browser.mjs` cover the current homepage, the documentation pages,
help-center routes and 404 pages.
