import {any,either,journeys} from '../journeys/kit/scenarios.mjs';
for(const module of ['api','native-boundary','docs','emitted','delivery','slack','migration'])await import(`./${module}.mjs`);

// Connections journeys and the scenarios each owns, through the real API, settings and dispatcher doors.
export const claims={
 credentials:['only current owners and admins issue workspace tokens; tokens hash once, show once, expire, revoke and record usage; issuance and revocation races are refused; bearer tokens never reach native settings',either(
  any('api',/^current native admins/,/^workspace tokens hash once/,/^issuance commit guard/,/^token revocation rejects/),any('native-boundary'))],
 api:['every scoped API operation keeps workspace, frontier and live-token authority at its write boundary, paginates exactly, answers misses alike without CORS, and the documented curl examples work',either(
  any('api',/^all foreign resource/,/^native API replies and resolve keep/,/^cursor pagination/,/^every API mutation rechecks/,/^API limits are per token/,/^foreign webhook and Slack settings/,/^REST article edits/,/^malformed JSON/,/^managed MCP tools/,/^Zapier polling/,/^Help Scout incremental/),any('docs'),any('emitted'))],
 erasure:['API writes and pending deliveries cannot recreate, revive or disclose an erased contact',either(
  any('api',/^erased identities cannot/,/^readback erasure/,/^API replies and resolve cannot revive/),any('delivery',/^destination policy, disabled/,/^erasure during protocol preparation/))],
 delivery:['each native event is signed over its exact bytes, delivered once to a verified receiver within bounded scheduling, and refused on configuration drift, redirects or oversized bodies',either(
  any('delivery',/^bounded scheduling/,/^all four native events/,/^real receiver accepts/,/^queued delivery refuses/,/^one cron invocation/,/^HTTPS delivery refuses every redirect/,/^HTTPS delivery bounds/,/^storage failure before durable enqueue/))],
 uncertainty:['a delivery whose outcome is unknown stays uncertain without automatic replay, rate limits retry the exact signed bytes within policy, and a deliberate resend is serialized and authority-checked',either(
  any('delivery',/^response timeout remains uncertain/,/^all server errors/,/^deliberate uncertain resend/,/^resend refuses/),any('api',/^destination disable refuses/))],
 slack:['Slack webhook and bot modes notify once inside their workspace; automatic mail and Move in history emit nothing; the integration upgrade keeps every prior row',either(
  any('slack'),any('delivery',/^native automatic inbound mail/),any('migration'))],
};
export const journey=journeys(claims);
