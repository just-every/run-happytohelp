# HappyToHelp browser widget

Selectable browser source: `index.jsx` exports `mountWidget({apiOrigin, widgetKey,
target?, settings?, theme?, text?, conversationSettings?})`. Build the standalone
embed with `pnpm build:widget`; include `/widget.js` with `data-api-origin` and
`data-widget-key`, or queue `['init', options]` in `window.h2hQueue`. The widget
imports no dashboard code. The native Worker owns the public widget key and exact
allowed embedding origin; the browser stores a contact bearer token under an
API-origin + widget-key key. Never supply an operator token in embed configuration.

This source ports the existing HappyToHelp React/Shadow DOM components, compiled
styles, branded assets, screenshot/file input, resize/preview, transcript Markdown,
typing and reply cancellation, contact collection, insight UI, and page collector.
The transport is native HTTP + conversation Durable Object WebSocket. Font Awesome
Pro imports are replaced with free solid icons. CRA, Sarus/API Gateway encryption,
service-worker registration, baked API origins and preview transcript fixtures are
not runtime dependencies. A single active embed owns the page collector; destroy
it before mounting another project. Consent revocation unmounts the socket/UI and
clears pending collected events and timers.

The values the widget renders when a project saves nothing (theme colors, copy and
setting switches) live in `js/context/defaults.js`. The dashboard's Widget settings
editor imports the same file, so what it shows is what the widget renders.

| Original behavior | Native integration |
| --- | --- |
| Persisted visitor identity and transcript | Contact session token and conversation ID persist per API origin/widget key; transcript refresh and socket replay |
| Optimistic send + local message identity | Existing bubble UI; native conditional admission and stable localId; failures remain visible |
| Reconnect and missed delivery | Bounded socket backoff, outbox cursor, transcript refresh, ID deduplication |
| Attachments, resize, preview and screenshot | Original controls; raw upload to scoped native media route; authenticated blob downloads |
| Streamed Markdown, typing, cancellation | Original helper semantics and components; native event mapping |
| Contact collection and page context | Native widget-events endpoint; collection can be disabled and awaits consent |
| Human/AI choice, insights, requests and read markers | UI retained; native widget-events endpoint must implement each action or reject explicitly |
| Isolation | Shadow DOM styles, exact Worker origin checks, scoped bearer authorization, separate storage keys |

Build success alone does not prove the native routes or provider behavior. Run
`pnpm run test:browsers` and `pnpm run test:browsers` for
local runtime/browser checks; provider-backed replies need a configured provider.
