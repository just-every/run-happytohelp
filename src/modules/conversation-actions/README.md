# Conversation actions

Mount `conversationActionRoutes` under `/api/dashboard`. Mutation doors use the
current native session, live membership/custom-role permission and ticket versions.

Merge preview/apply: `POST /projects/:projectId/conversations/:conversationId/merge[/preview]`,
with `{source_id,source_version,target_version}`. The URL ticket survives.
History: `GET .../merges`; undo: `POST .../merges/:mergeId/undo`.
Operator history: `GET .../merged-history?page=1`, ten native buckets per source.
Sources remain intact; messages, notes, files, requester, status and resolution
evidence are never moved. Merge creates no message/outbox/mail/resolution event.
Undo refuses a changed ticket frontier or partner activity after merging.
An already-merged target can receive more sources; a source with its own merged
children must first undo those merges. No recursive graph or cycle is admitted.

Shared integration requirements:

- Append `writableConversationSql('c')` to all message/ticket SQL admission guards.
  Apply it to operator queue/report cohorts to exclude active source aliases.
- Operator aliases may redirect through `mergedAlias`. `operatorThreadIds` and
  `/merged-history` are for current authorized operators only.
- Widgets/customer media/notifications never use the union. A same-contact widget
  can use `customerMergeTarget`; it returns a survivor only if both current rows
  have that exact contact. Redirect then reload its revision before sending.
- Export `inboundEmail` and `handleEmail` from `partner-gateway` in the integrations
  public entry. It intercepts only actual issued private grants and delegates
  ordinary mail unchanged. JSON gateway, SendGrid Parse and Cloudflare Email
  Routing use the same private receiver. Grant-less and header-only thread keys
  never grant partner authority. Wrong senders, failed sender verdicts and revoked
  invitations are refused. No public conversation participant is created.

Partner forward preview/apply: `POST .../partner-forwards[/preview]` with
`{recipient,message_ids,subject,note,expected_version,idempotencyKey}`. Private notes
and messages from other tickets are refused. Preview includes customer identity,
source channel, chosen text/files and private reply visibility. `GET .../partner-forwards`
returns private history; `DELETE .../partner-forwards/:forwardId` revokes replies.
File download is `GET .../partner-files/:fileId`, requiring operator access.

The small alternative receiver hook is `receivePartnerReply(env,{projectId,
conversationId,replyToken,sender,localId,content,senderFailed?,attachments?})`.
`null` means no issued partner grant. A recognized invalid/revoked grant throws;
never fall through then. Delivery is private and durable with message identity
and attachment ownership; no customer, AI or acknowledgement effect runs.
Uncertain outbound delivery is retained without automatic resend.

Compose erasure *before contact redaction*: stage objects with
`conversationActionErasureStage`, count with `conversationActionErasureCount`, then
include `conversationActionErasureStatements` in the existing erasure transaction.
R2 objects use the existing `media` erasure ledger with `partner-file:` IDs.
Grant hashes survive as revoked redacted routing tombstones, so an old private
reply cannot become ordinary customer intake after erasure. No email, text,
subject, selected IDs, command or intent remains. Merge journals for the erased
contact are removed. Audits contain only operation IDs and counts.
`conversationActionExportStatements` exports all four stores; include
`partner_reply_files.object_key` in the portable attachment inventory.

UI entry: `ConversationActions` takes `{conversation,messages,onChanged}`. It
extends the existing Bootstrap controls. The caller reloads conversation data in
`onChanged`; only authorized messages from the current ticket should be supplied.
The focused public journey is `conversationActionsJourney` in
`tests/helpers/r4/conversation-actions.mjs`.
