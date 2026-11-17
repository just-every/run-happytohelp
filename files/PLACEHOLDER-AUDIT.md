# Ticket placeholder audit
Run Edit Run fleet · 2026-11-17

Baseline: `94f64dfc35d938bd92b59bac9e938c11be10c27d` (fresh main, newer than the brief's `20b254ff`). The synthetic Maya widget ticket reproduced `{{ticket.id}}` expanding to its raw UUID. See `before-receipt.json` and `browser/before-macro-{1440,390}.png`.

| Customer-visible expansion door | Shared context | Current ticket.id value |
| --- | --- | --- |
| Saved reply insertion, action-macro preview/application, public composer draft | `src/modules/macros/context.ts` → `loadMacroContext` → `renderPlaceholders` | `ticket.id` (internal primary key) |
| Problem/incident bulk recovery reply preview and send | `src/modules/tickets/problem-preview.ts` → the same macro context | Internal primary key |
| Request-received and solved customer acknowledgments, including subjects and bodies | `src/modules/integrations/triggers/context.ts` → `notificationTemplateContext` → `renderNotificationTemplate` | Internal primary key |
| Native workflow customer updates and notification actions | `src/modules/workflows/notify.ts` / `src/modules/integrations/notification-actions.ts` → the same notification context | Internal primary key |
| Imported macro placeholders | Zendesk `ticket.id` maps to native `ticket.id`; application uses the macro context above | Internal primary key |

The WhatsApp approved-template continuation uses explicitly supplied numeric parameters (`{{1}}`, etc.); it does not resolve ticket placeholders.

The current conversation schema has `id`, subject, status, fields and revision/version, with no independent customer reference/number. The inbox's “Ticket reference” filter targets `id`. The widget and portal expose the same internal identity in their routes/data; the portal labels requests by subject. The dashboard contact/header/ticket views do not supply another customer-friendly number. No separate reference formatter or persisted reference was found in the native code. Imported vendor source references apply only to imported tickets, not a new Maya widget request. Native email threading adds an H2H subject marker containing that same internal ID, so it is not an independent friendly reference either.

**Unresolved item 2:** the brief requires reusing the reference the product already shows people and prohibits a migration. No such existing reference could be identified on this main. A clarification asking which screen shows it is pending. No replacement identifier was invented and no raw-UUID expansion was claimed fixed. The two shared expansion contexts above are the required edit sites once the intended reference is identified.
