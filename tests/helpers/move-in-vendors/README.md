# Move in vendor HTTP fixtures

`index.mjs` exports `startVendor(vendor, {tickets = 305} = {})`, where vendor is
`zendesk`, `intercom`, `helpscout`, or `freshdesk`. It starts a Node HTTP server on
an ephemeral loopback port. It does not contact a provider or read credentials.
Always call `await fixture.close()` in `finally`.

```js
import {startVendor} from './move-in-vendors/index.mjs';

const fixture = await startVendor('freshdesk');
try {
    const response = await fetch(fixture.baseUrl + '/api/v2/tickets?updated_since=1970-01-01T00:00:00Z&per_page=100', {
        headers: {Authorization: fixture.authorization()},
    });
    // Pass fixture origin and credentials through the real API connection door.
} finally {
    await fixture.close();
}
```

Returned values:

- `baseUrl`, `docsBaseUrl`: the same local origin; all relevant vendor paths are mounted there.
- `email`, `token`, `docsToken`, `wrongToken`, `scopeToken`, `rateToken`: arbitrary synthetic fixture credentials.
- `authorization(value = token, {docs = false} = {})`: correct vendor Authorization header. Help Scout Docs needs `authorization(docsToken, {docs:true})`.
- `requestLog` (alias `requests`): ordered `{method,path,url,query,auth,intercomVersion,status,body?}`; no credential headers. `auth` is only `valid`, `wrong`, `scope`, or `rate`.
- `violations`: incorrect Intercom version, HTTP method, unknown path, or internal fixture errors. Expected 401/403/429 and configured faults do not add violations.
- `corpus`: synthetic tickets, comments, agents, contacts, companies, articles and attachment metadata. Tests may inspect or deliberately mutate it.
- `emailEvidence(ticketId = 1, commentId?)`: mutable historical email evidence, backed by `corpus.tickets[].comments[].email`. The default comment is the first public outbound reply for Zendesk/Intercom and the first inbound customer thread for Help Scout. Fields include `messageId`, `notificationId`, `subject`, `from`, `to`, `cc`, `references`, and `bodyDecoyMessageId`. Freshdesk returns only ticket/comment identity and its `[#id]` subject token, since its API does not expose Message-ID evidence.
- `configureEmailEvidence({ticketId = 1, commentId?, ...changes})`: configure an old notification's `messageId`/`notificationId` or addresses before import. Returns the same evidence object. For example, `fixture.configureEmailEvidence({messageId:'<old-notification@fixture.example.test>'})`; later use `fixture.emailEvidence().messageId` for real inbound `In-Reply-To`. Freshdesk rejects this configuration rather than fabricating API evidence.
- `change(options)`: defaults to one new ticket, a public reply on ticket 1, and closing ticket 2. Options are `addTickets`, `replyTo`, `reply:false`, `private`, `body`, `statusTicket`, `status:false`, and `at` (epoch milliseconds or ISO). Returns `{at,added,replyId,statusTicket}`. Each invocation advances the synthetic clock one minute.
- `fault({after=0,path,status=503,once=false,disconnect=false,headers={},body})`: after that many matching authenticated requests, fail subsequent matches. `path` is a substring or RegExp. Returns a function that disables this fault.
- `stopAfter(n, options)`: shorthand for `fault({...options,after:n})`; register immediately before starting a delta to interrupt its fetch. Requests are still logged. `clearFaults()` resumes normal behavior.
- `clearRequests()`: clears request and violation logs.

Normal token succeeds; unknown or `wrongToken` gives 401, `scopeToken` gives
403, and `rateToken` gives 429 with `Retry-After: 1`. Intercom requires
`Intercom-Version: 2.16`, and search requires JSON POST. Zendesk accepts both its
documented Basic email/token form and OAuth Bearer; Freshdesk and Help Scout Docs
use Basic key:X, while Intercom and Help Scout Inbox use Bearer.

Help Scout links intentionally contain `https://api.helpscout.net`, as its reader
validates canonical pagination and attachment URLs. The test transport must rewrite
the network origin to `fixture.baseUrl` while retaining the canonical request path,
query and vendor authorization. Rewrite **both** `api.helpscout.net` and
`docsapi.helpscout.net`; no fixture test should contact these real hosts. The
product sees vendor-shaped URLs. Other vendors emit local next-page and attachment
URLs. No fixture-only routes are needed in product code.

The default corpus contains 305 current tickets across 90 days, 305 customers,
12 companies, 5 active and 2 deleted agents, 6 articles (one unpublished with a
draft), public replies, private notes, CCs, tags, timestamps and merged history.
Ticket 1 has 107 comments, forcing comment/thread paging. There are 45 attachment
references: id 9044 serves exactly 8 MiB, id 9045 returns 404, the remaining 43
serve small deterministic text files. Attachments require the vendor credential.
Freshdesk separates ticket 5 into its spam pass and enforces the documented
30-day default when `updated_since` is absent. Help Scout includes a merge
lineitem on ticket 1; stale ID `corpus.mergedConversationId` redirects to ticket
1, while its thread endpoint returns 404. Active ticket count remains 305.

Freshdesk removed agents resolve as 404 from `/agents/:id` and as deleted
contacts from `/contacts/:id`, without an invented former-agent flag. Their
ticket `responder_id` retains the documented staff identity relationship.

Historical email evidence uses documented surfaces: Zendesk
`/api/v2/email_notifications?filter[ticket_id]=id&per_page=100` returns public
outbound notifications with cursor exhaustion metadata; comment metadata has no
fabricated Message-ID. Intercom conversation details include source
`email_message_metadata` only with `include_email_history=true`; public email
parts also carry their documented metadata. Help Scout inbound customer email
threads expose `/v2/conversations/:id/threads/:threadId/original-source` as
`{original: rawMime}`. Outbound/private thread source requests return 404.
The MIME includes folded `References` and a deliberately different `Message-ID`
line in the body, so the journey can prove only headers become routing evidence.
Freshdesk preserves a `[#id]` subject token and adds no synthetic API header fields.

REST shapes come from the official documentation:

- [Zendesk incremental exports](https://developer.zendesk.com/api-reference/ticketing/ticket-management/incremental_exports/), [ticket comments](https://developer.zendesk.com/api-reference/ticketing/tickets/ticket_comments/), [pagination](https://developer.zendesk.com/api-reference/introduction/pagination/).
- [Intercom Data API 2.16](https://developers.intercom.com/docs/references/rest-api/api.intercom.io/conversations), [retrieve conversation](https://developers.intercom.com/docs/references/rest-api/api.intercom.io/conversations/retrieveconversation).
- [Help Scout conversations](https://developer.helpscout.com/mailbox-api/endpoints/conversations/list/), [threads and merges](https://developer.helpscout.com/mailbox-api/endpoints/conversations/threads/list/), [Docs article lists](https://developer.helpscout.com/docs-api/articles/list/).
- [Freshdesk API v2](https://developers.freshdesk.com/api/).
- [Zendesk email notifications](https://developer.zendesk.com/api-reference/ticketing/tickets/email_notifications/), [Intercom 2.16 email history](https://developers.intercom.com/docs/references/changelog), [Help Scout original email source](https://developer.helpscout.com/mailbox-api/endpoints/conversations/threads/thread-source-json/).

The helpers contain no test declarations and run no servers until explicitly started.

Zendesk secure downloads include a 302 to a temporary download URL, following [Zendesk’s documented attachment flow](https://developer.zendesk.com/documentation/ticketing/managing-tickets/accessing-end-user-uploaded-attachments/). Help Scout original-source JSON includes a multipart MIME body for the 8 MiB email attachment; only its RFC header block becomes threading evidence.
