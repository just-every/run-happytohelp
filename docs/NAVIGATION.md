# Native navigation

HappyToHelp has one authenticated TanStack Router layout. The pathless
`src/routes/_dashboard.tsx` validates implemented paths on the server so unknown
documents return HTTP 404. Every unmatched document, including dashboard-shaped
paths that fail that check, renders the root route's `notFoundComponent`
(`src/ui/homepage/NotFound.tsx`): a branded page in the homepage visual language
with the title "Page not found · HappyToHelp", a short message and links to the
homepage and the workspace. Help Center addresses have their own 404 pages (see
`src/modules/public-site/README.md`). `/docs` and `/docs/<slug>`
(`src/routes/docs.index.tsx`, `src/routes/docs.$slug.tsx`) are public document
routes outside the dashboard layout, rendering the repository Markdown listed in
`docs/site.json`; an unknown slug throws `notFound()` in the loader and renders the
same branded 404. The dashboard layout's nested pathless
`src/routes/_dashboard._workspace.tsx` is the client-only boundary with
pending/error handling and the persistent shell. The workspace's index and splat
leaves render `DashboardContent` and attach the bootstrap loader;
`dashboard-path.js` admits only the dashboard paths this edition implements.
Underscore layout names contribute no URL segment. Login, setup and the other
identity pages remain document routes outside this layout.

## Loader context and shell lifetime

`dashboardLoaderOptions` is applied to both leaf routes. The native match is
identified by the current pathname, while `loaderDeps` explicitly includes
search values; `shouldReload: true`, zero stale/cache times and
`staleReloadMode: 'blocking'` keep the last committed workspace visible while a
new read settles. `loadDashboard` derives the project from the URL and reads
the committed `/api/management/bootstrap` response. It returns the
project/global-inbox scope, normalized search location, `apiUrl` and a session
version. `Dashboard` reads `matches.at(-1)` with `useMatches` and takes that
committed leaf match's `loaderData` into `DashboardSettingsContext`; routing
does not use `window.chatSettings` (which remains only a compatibility input
for embedded legacy components). A 401 redirects to `/login` with a validated
`returnTo`; a session-version change invalidates the old router cache before a
new workspace is accepted.

## Workspace scoping

The URL chooses the workspace. When the path names a project
(`/projects/<id>/...`), `loadDashboard` reads the bootstrap for that project and,
if the response's `sessionProjectId` differs, posts
`/api/identity/switch-project` before the workspace renders. Pages and the
session-scoped APIs they call (knowledge, training, insights, conversation
media) therefore always agree with the URL, whether the project was opened from
a deep link, the Projects list or the workspace switcher. The switcher still
posts the switch itself and then navigates; the loader sees a matching session
and does nothing more.

The session cookie holds one active project, so tabs on different projects share
it. After each load the loader announces the session's project on the
`h2h-session-project` BroadcastChannel (`session-project-sync.ts`). A tab whose
URL names another project marks itself displaced and, when its window regains
focus, re-runs the loader, which re-activates its project (or shows the
unavailable state if access was removed meanwhile). Tabs therefore never ping-pong
the session while both are open; only the tab the user returns to rebinds it.

A project the account does not belong to, or that does not exist, is not a
failed load. The bootstrap refuses it with a message-bearing 403, the loader
reads the account's own bootstrap instead and marks the result
`projectUnavailable`. The shell stays mounted with the workspace labelled
"Workspace unavailable", the inbox is not rendered, and the page offers
"Go to Projects"; no "Sign in" link is shown to a signed-in user. The route
error boundary offers "Sign in" only for a 401 and otherwise "Try again" and a
way back to the inbox.

`/local-agent/authorize` has no project in the URL but acts on the session's
project, so the loader scopes it to that project: the sidebar shows that
project's Settings menu with "Local computers" current, and the authorize form
names the project it approves or denies for. In the Global Inbox
the Settings disclosure lists "Settings for <project>" per project instead of
unlabelled links to the session's project.

## The sidebar and the Settings menu

A project's sidebar holds the daily work: Inbox with its views (Yours, Open,
Unassigned, With AI, Closed, then saved views, Snoozed and Suspended while they
apply), Knowledge, Contacts and Reports (Insights is a tab of Reports), then one
**Settings** row and the account row. There is no More group. The current row is
an aqua highlight with `aria-current="page"`, never an edge rule, and a count
disc shows only while its number is above zero. The Global Inbox keeps Inbox
plus closed Contacts and Settings disclosures that list one link per project.

Everything that configures the workspace is under Settings, listed in
`src/ui/native/settings-destinations.js`: Setup, then Workspace (Project, Widget,
Email, Suspended email), Team (Agents, Roles, Security, Security log), Support
(Tickets, Saved Replies), Automation (AI, Workflows, Local computers) and
Connections (Slack, GitHub, Webhooks, API tokens, Plugins, Connected applications,
Delivery log). On any of those pages (and on Move in, reached from Project) the
sidebar itself becomes the Settings menu (`SettingsNavigation.jsx`): the Inbox
row turns into a way back to the inbox, the destinations follow under their
topic captions with the current one highlighted, and the Settings row reads as
the section. Below 1200px the same menu is in the menu sheet, and a Settings pill
above each Settings page's title opens it there. Settings pages have no second
menu of their own, so they use the full width. Every page keeps its URL.

Setup is not a daily row: it heads the Settings menu. For an owner or admin,
the Settings row and Setup's own row count the Setup steps that still need them
(one read of the stored snapshot, `activation/useSetupNeeds.js`), and the count
goes once nothing does. No page carries the workspace's name above its title:
the sidebar's switcher names the workspace.

The bootstrap also carries `isPlatformAdmin`. The account menu offers Admin
only to platform administrators, and `/admin` pages show an in-shell
"limited to platform administrators" state, with no tables or forms and no admin
API calls, to everyone else. `/users/<id>` is the signed-in user's profile only
for `profile` or their own id; any other id is a not-found page.

`DashboardClient` keeps `Navigation`, `NavigationGuard` and the shell around the
child outlet while the pathless workspace parent remains mounted. The
conversation `ChatContext` provider is keyed by session, agent and
project/global scope. A workspace switch first changes the server-side project
identity, then routes to that project's inbox; the changed key remounts the
provider and prevents the previous project's conversation state from leaking.
The widget settings page has its own route-scoped provider and removes its
preview script on unmount.

## Which navigation is intentional

Use TanStack `Link` for ordinary in-app navigation: sidebar items, settings
tabs, list/detail links and page actions. These update the URL and outlet while
preserving the document, sidebar and shell. Inbox `q` and `view` values are
router search state, so Back/Forward restores the corresponding controls.

Some transitions deliberately replace or leave the document:

- Login and first-owner setup use `location.assign` after the identity request
  so the new session starts from a fresh document. Login sanitizes `returnTo`
  and accepts only an in-origin dashboard path.
- GitHub Connect posts for a short-lived OAuth state, then assigns the returned
  GitHub authorization URL. GitHub redirects back to the API callback, which
  redirects to the project settings document route.
- Downloads, retained artifacts, help-center previews, media, mail links and
  external provider/docs links use ordinary anchors (usually a new tab). They
  are document or external-resource transitions by design and should not be
  converted to router links.

## Delegation pages

Connected applications (`/delegation/settings?account_id=<project>`) and the connection
consent screen (`/delegation/authorize?...`) are dashboard documents like any other: the
Worker hands only their `GET`/`HEAD` requests to Start (`src/edition/delegation/document.ts`,
which first redirects a request without a current session to `/login` with its `returnTo`, and
makes the response `no-store` and unframeable), while every `POST` under `/delegation/`
and their JSON reads (`/delegation/settings/data`, `/delegation/authorize/request`) stay in
Hono with their session, origin, CSRF and role checks. `loadDashboard` scopes the shell to
`account_id`, and loads the consent request before the screen renders so the heading and the
decision form appear together; a rejected request becomes a page for the user, not JSON. The
consent decision remains a real form post so approval ends in a redirect to the application;
cancel returns to Connected applications with a notice. Bare `/delegation/settings` offers the
user's workspaces and bare `/delegation/authorize` explains that an application starts the
request.

The router's `parseSearch`/`stringifySearch` (`src/search-codec.ts`) keep text such as `1e3`
or a device code like `12E4567890` exactly as written; the default would turn it into a
number and change an OAuth `state` or authorization code.

## Unsaved editing

`NavigationGuard` is mounted once inside the persistent shell. Editors call
`useUnsavedChanges` to register a per-component dirty marker and clear it after
save or unmount. A path change that would replace the editor asks whether to
discard; inbox search/filter changes keep the same conversation path and do not
block the draft. The guard also protects explicit session-changing commands:
workspace switching and sign-out ask before their request. A cancelled or
failed request leaves the dirty marker and draft in place. Browser unloads are
covered while any marker remains, and confirmed navigation can intentionally
discard the draft without writing it.

## Browser coverage

Run the focused browser check after producing the current build:

```sh
pnpm run build
pnpm run test:navigation-browser
```

`tests/journeys/delegation-browser.mjs` (`pnpm run test:computers-delegation-browser`) covers the
Local computers dialog and authorization outcomes and the delegation pages above in the emitted
Worker and a real browser.

`tests/journeys/inbox-browser.mjs` starts an isolated local D1/R2/Durable Object
runtime from the emitted Worker (`dist/server/wrangler.json` and its emitted
server bundle), seeds real tenants through the Worker APIs, and drives the
actual browser UI. It exercises delayed loader reads, shell/document identity,
header portals, search and Back/Forward, project isolation and theme changes,
dirty conversation and settings edits, widget mount/unmount, mobile navigation,
direct refresh/not-found recovery, sign-out and expired-session recovery.
`tests/journeys/inbox-browser.mjs` (`pnpm run test:workspace-shell-browser`)
covers the workspace scoping above: deep links and Projects-list navigation
activating the URL's project, unavailable projects, `/local-agent/authorize`,
Global Inbox settings labels, sidebar active/visible state, account-menu
contrast, Admin gating, the Projects list, `/users/<id>` and socket start-up
without teardown warnings.
`pnpm run test:not-found-browser` separately drives the application and Help Center
404 pages at desktop and mobile sizes (status, content type, title, links, axe, and a
draft article being indistinguishable from a missing one). The navigation
test writes its result and request evidence under `H2H_EVIDENCE_DIR` (or a
temporary directory). This document records the contract and command; a test
run must report its own result and exact source revision.

## Relationship to UI parity

`docs/UI-PARITY.md` is the historical 15 September comparison record against a
running Laravel reference. It describes restored presentation surfaces,
screenshots and known legacy feature gaps; it explicitly does not claim full
legacy equality. This document describes the current native route and state
lifecycle. The parity record is comparison evidence, not a second router or a
requirement to reproduce legacy document transitions.

## Compiled visual edits and hydration

The root installs compiled visual edits while paused and pauses them before each
navigation. Every actual leaf must resume them after its React commit through
`withVisualEdits`. Wrap the resolved component inside a lazy import, not an
intermediate layout or a component surrounding `Suspense`/`Outlet`: those may
commit before the rendered leaf hydrates. The wrapper adds no DOM and observes
the route href so reused wildcard and query-only navigation resume correctly.
Keep this boundary when adding routes. `pnpm run verify:visual` checks the saved
snapshot, source integrity, types, build and an isolated local browser journey.
The focused profile also compiles a test-only login-heading edit and checks SSR
hydration, reload and return navigation for browser errors. Run it in a dedicated
checkout: this regression temporarily replaces `visual-edits.json`, then restores
its exact bytes and rebuilds the original snapshot in `finally`.
