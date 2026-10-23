import type {Permission} from './catalogue'
import {selfServiceRules} from './self-service-routes'
import {r4RouteRule} from './r4-route-permissions'

/**
 * Which permission each authenticated door needs, keyed by `METHOD registered-path`.
 * 'self' is the signed-in person's own account or reading; 'none' is a door a native
 * session never authorizes (public, visitor, device, API-token or platform-admin doors,
 * which keep their own authority). Built-in owner, admin and agent roles keep the
 * handlers' existing checks; this table narrows custom roles and collaborators. A
 * mutating door missing here is refused to a collaborator, and the identity journey
 * fails until it is classified.
 */
type Rule=Permission|'self'|'none'
const P='/api/management/projects/:projectId',D='/api/dashboard/projects/:projectId',C=`${D}/conversations/:conversationId`,K='/api/knowledge/:projectId',X='/api/customer-context/:projectId/:subjectId',L='/api/projects/:project'
const rules:Record<string,Rule>={
 // Own account and sign-in
 'POST /auth/signout':'self','POST /api/identity/switch-project':'self','POST /api/identity/password':'self','POST /api/identity/accept-invitation':'self','DELETE /api/identity/session':'self',
 'PUT /api/management/profile':'self',[`PUT ${P}/agents/:userId/primary`]:'self',
 'POST /api/identity/two-factor/totp':'self','POST /api/identity/two-factor/totp/confirm':'self','POST /api/identity/two-factor/webauthn/options':'self','POST /api/identity/two-factor/webauthn':'self',
 'DELETE /api/identity/two-factor/factors/:factorId':'self','POST /api/identity/two-factor/recovery-codes':'self','POST /api/identity/two-factor/verify':'self','POST /api/identity/two-factor/assertion-options':'self','POST /api/identity/step-up':'self','POST /api/identity/step-up/email':'self',
 'POST /api/identity/password-reset':'members.manage',
 // Conversations
 'POST /api/conversations':'conversations.reply','POST /api/conversations/:id/messages':'conversations.reply','POST /api/conversations/:id/media':'conversations.reply',
 [`PUT ${C}`]:'conversations.manage',[`POST ${C}/actions`]:'conversations.manage',
 [`POST ${C}/notes`]:'conversations.notes',[`DELETE ${C}/notes/:noteId`]:'conversations.notes',
 [`GET ${C}/followers`]:'self',[`POST ${C}/follow`]:'conversations.follow',[`DELETE ${C}/follow`]:'conversations.follow',
 [`POST ${C}/participants`]:'conversations.manage',[`DELETE ${C}/participants/:participantId`]:'conversations.manage',
 [`POST ${C}/tags`]:'conversations.manage',[`DELETE ${C}/tags/:tagId`]:'conversations.manage',
 [`POST ${D}/media`]:'conversations.reply',
 'POST /api/ai-support/projects/:projectId/conversations/:conversationId/generations':'conversations.reply','POST /api/ai-support/projects/:projectId/generations/:id/cancel':'conversations.reply','POST /api/ai-support/projects/:projectId/conversations/:conversationId/suggestions':'conversations.reply',
 [`POST ${L}/conversations/:conversation/delegations`]:'conversations.reply',[`POST ${L}/conversations/:conversation/delegations/:job/cancel`]:'conversations.reply',[`POST ${L}/conversations/:conversation/delegations/:job/input`]:'conversations.reply',
 [`POST ${L}/conversations/:conversation/delegations/:job/result/draft`]:'conversations.reply',[`POST ${L}/conversations/:conversation/delegations/:job/result/replies/:proposal/send`]:'conversations.reply',[`POST ${L}/conversations/:conversation/delegations/:job/result/follow-up-actions/:proposal`]:'conversations.reply',
 // Customer context and contacts
 [`PUT ${X}/consent`]:'contacts.manage',[`POST ${X}/evidence`]:'contacts.manage',[`PUT ${X}/profiles/:type`]:'contacts.manage',[`POST ${X}/insights`]:'contacts.manage',[`POST ${X}/insights/:insightId/dismiss`]:'contacts.manage',[`PUT ${X}/monitoring`]:'contacts.manage',[`POST ${X}/generate/:kind`]:'contacts.manage',[`POST ${X}/jobs/:jobId/abandon`]:'contacts.manage',
 [`POST ${P}/contacts/:contactId/erase`]:'data.erase',
 // Knowledge
 [`POST ${K}/articles`]:'knowledge.publish',[`DELETE ${K}/articles/:articleId`]:'knowledge.publish',[`PUT ${K}/articles/:articleId/categories`]:'knowledge.edit',[`PUT ${K}/articles/:articleId/order`]:'knowledge.edit',
 [`POST ${K}/categories`]:'knowledge.edit',[`PUT ${K}/categories/:categoryId`]:'knowledge.edit',[`DELETE ${K}/categories/:categoryId`]:'knowledge.edit',
 [`POST ${K}/datasets`]:'knowledge.publish',[`PUT ${K}/datasets/:datasetId`]:'knowledge.publish',[`POST ${K}/datasets/:datasetId/crawl`]:'knowledge.publish',[`POST ${K}/datasets/:datasetId/refresh`]:'knowledge.publish',[`DELETE ${K}/datasets/:datasetId`]:'knowledge.publish',
 [`POST ${K}/import/:platform`]:'data.import',
 // Members and roles
 [`POST ${P}/agents`]:'members.manage',[`PUT ${P}/agents/:userId`]:'members.manage',[`DELETE ${P}/agents/:userId`]:'members.manage',
 [`DELETE ${P}/invitations/:invitationId`]:'members.manage',[`POST ${P}/invitations/:invitationId/link`]:'members.manage',[`POST ${P}/invitations/:invitationId/resend`]:'members.manage',
 [`POST ${P}/roles`]:'members.manage',[`PUT ${P}/roles/:roleId`]:'members.manage',[`DELETE ${P}/roles/:roleId`]:'members.manage',
 [`PUT ${P}/security`]:'members.manage',[`POST ${P}/agents/:userId/two-factor/reset`]:'members.manage',
 // Security log
 [`GET ${P}/audit`]:'audit.view',[`GET ${P}/audit/export`]:'data.export',[`PUT ${P}/audit/retention`]:'settings.manage',[`POST ${P}/audit/holds`]:'settings.manage',[`POST ${P}/audit/holds/:holdId/release`]:'settings.manage',
 // Reports
 [`GET ${D}/reports`]:'reports.view',
 [`GET ${D}/reports/team`]:'reports.view',
 [`GET ${D}/report-schedules`]:'data.export',
 [`POST ${D}/report-schedules`]:'data.export',
 [`PATCH ${D}/report-schedules/:scheduleId`]:'data.export',
 [`DELETE ${D}/report-schedules/:scheduleId`]:'data.export',
 // Workspace settings
 'POST /api/management/projects':'settings.manage',[`PUT ${P}/settings`]:'settings.manage',[`DELETE ${P}`]:'data.erase',
 [`PUT ${P}/appearance`]:'settings.manage',[`PUT ${P}/artwork`]:'settings.manage',[`PUT ${P}/widget-settings`]:'settings.manage',[`PUT ${P}/availability`]:'settings.manage',[`PUT ${P}/ai`]:'settings.manage',
 [`POST ${P}/brand-media`]:'settings.manage',[`POST ${P}/activation/check`]:'settings.manage',[`POST ${P}/activation/skip`]:'settings.manage',[`POST ${P}/activation/test-mail`]:'settings.manage',
 [`PUT ${P}/email-settings`]:'settings.manage',[`POST ${P}/email-settings/test`]:'settings.manage',[`POST ${P}/inbound-emails/:messageId/reconcile`]:'conversations.manage',
 'POST /api/site-preview/projects/:projectId/brand-image-generations':'settings.manage','POST /api/site-preview/projects/:projectId/brand-assets':'settings.manage','PUT /api/site-preview/projects/:projectId/brand-assets/:id/publish':'settings.manage','POST /api/site-preview/projects/:projectId/preview':'settings.manage',
 'POST /api/training/projects/:project/runs':'settings.manage','POST /api/training/projects/:project/runs/:run/cancel':'settings.manage','POST /api/training/synthetic-workspace':'settings.manage',
 // Integrations and credentials
 [`POST ${P}/connections/tokens`]:'integrations.install',[`DELETE ${P}/connections/tokens/:id`]:'integrations.install',
 [`POST ${P}/connections/webhooks`]:'integrations.install',[`DELETE ${P}/connections/webhooks/:id`]:'integrations.install',[`POST ${P}/connections/webhooks/:id/test`]:'integrations.install',
 [`POST ${P}/connections/slack`]:'integrations.install',[`DELETE ${P}/connections/slack/:id`]:'integrations.install',[`POST ${P}/connections/slack/:id/test`]:'integrations.install',
 [`POST ${P}/connections/deliveries/:id/resend`]:'integrations.install',
 [`PUT ${P}/github`]:'integrations.install',[`POST ${P}/github/connect`]:'integrations.install',[`DELETE ${P}/github`]:'integrations.install',
 [`POST ${L}/local-agents/pairings`]:'integrations.install',[`DELETE ${L}/local-agents/:device`]:'integrations.install',[`PUT ${L}/local-agents/:device/settings`]:'integrations.install',
 [`POST ${L}/local-agent-authorizations/decision`]:'integrations.install',[`DELETE ${L}/local-agent-grants/:grant`]:'integrations.install',
 'POST /delegation/authorize':'integrations.install','POST /delegation/settings/revoke':'integrations.install','POST /delegation/settings/clients':'integrations.install',
 // Move in
 'POST /api/move-in/projects/:projectId/imports':'data.import','POST /api/move-in/projects/:projectId/imports/:runId/apply':'data.import','POST /api/move-in/projects/:projectId/imports/:runId/resume':'data.import','POST /api/move-in/projects/:projectId/imports/:runId/undo':'data.import',
 // Doors with their own authority
 'POST /auth/bootstrap':'none','POST /auth/owner-claim':'none','POST /api/identity/login':'none','POST /api/identity/accept-token':'none','POST /api/identity/forgot-password':'none','POST /api/identity/widget/session':'none','POST /api/identity/register':'none','POST /api/identity/verify-email':'none','POST /api/identity/bootstrap':'none','POST /api/identity/link-status':'none','POST /api/identity/magic-link':'none','POST /api/identity/magic-link/consume':'none','POST /api/identity/owner-recovery':'none',
 'POST /api/conversations/:id/widget-events':'none','POST /api/integrations/email/inbound':'none','POST /api/integrations/email/sendgrid/inbound':'none','POST /api/dashboard/demo-inbox':'none',
 'POST /api/delegation/v1/token':'none','POST /api/delegation/v1/effects':'none','POST /api/delegation/v1/revoke':'none',
 'POST /api/local-agents/pair':'none','POST /api/local-agents/heartbeat':'none','POST /api/local-agents/device-authorizations':'none','POST /api/local-agents/device-authorizations/token':'none','POST /api/local-agents/task-sessions':'none','POST /api/local-agents/claim':'none','POST /api/local-agents/jobs/:job/progress':'none','POST /api/local-agents/jobs/:job/result':'none','POST /api/local-agents/jobs/:job/attachments':'none',
}
// Resource routes are mounted under both /api/management and /api/dashboard.
for(const [kind,rule] of [['ais','settings.manage'],['macros','settings.manage'],['plugins','settings.manage'],['contacts','contacts.manage']] as const)for(const base of [P,D]){
 rules[`POST ${base}/${kind}`]=rule;rules[`PUT ${base}/${kind}/:resourceId`]=rule;rules[`DELETE ${base}/${kind}/:resourceId`]=kind==='contacts'?'data.erase':rule
}
for(const base of [P,D]){rules[`PUT ${base}/agents/:userId`]='members.manage';rules[`DELETE ${base}/agents/:userId`]='members.manage';rules[`POST ${base}/plugins/:pluginId/:direction`]='settings.manage'}
// Ticket configuration follows existing settings authority; personal views are
// self-owned and their handlers separately guard shared definitions.
for(const base of [P,D]){
 rules[`GET ${base}/triage-settings`]='self'
 rules[`PUT ${base}/triage-settings`]='settings.manage'
 rules[`GET ${base}/conversations/:conversationId/triage`]='self'
 rules[`PATCH ${base}/conversations/:conversationId/triage`]='conversations.manage'
 rules[`GET ${base}/ticket-settings`]='self'
 rules[`GET ${base}/ticket-problem-search`]='conversations.manage'
 rules[`GET ${base}/conversations/:conversationId/ticket`]='self'
 rules[`PATCH ${base}/conversations/:conversationId/ticket`]='conversations.manage'
 for(const method of ['GET','PATCH'])rules[`${method} ${base}/conversations/:conversationId/ticket/problem`]='conversations.manage'
 for(const action of ['incidents/preview','incidents/apply','solve/preview','solve/apply'])rules[`POST ${base}/conversations/:conversationId/ticket/problem/${action}`]='conversations.manage'
 rules[`GET ${base}/conversations/:conversationId/ticket/problem/solve/:previewId`]='conversations.manage'
 rules[`GET ${base}/conversations/:conversationId/timer`]='conversations.manage'
 for(const action of ['start','stop','adjust'])rules[`POST ${base}/conversations/:conversationId/timer/${action}`]='conversations.manage'
 for(const kind of ['statuses','fields','groups']){
  rules[`GET ${base}/ticket-${kind}`]='self'
  rules[`POST ${base}/ticket-${kind}`]='settings.manage'
  rules[`PATCH ${base}/ticket-${kind}/:id`]='settings.manage'
  rules[`DELETE ${base}/ticket-${kind}/:id`]='settings.manage'
 }
 rules[`GET ${base}/ticket-views`]='self'
 rules[`GET ${base}/ticket-views/:viewId`]='self'
 rules[`POST ${base}/ticket-views`]='self'
 rules[`PUT ${base}/ticket-views/:viewId`]='self'
 rules[`DELETE ${base}/ticket-views/:viewId`]='self'
 for(const action of ['preview','apply'])rules[`POST ${base}/tickets/bulk/${action}`]='conversations.manage'
}


for(const base of [P,D]){
 for(const path of ['workflow-calendars','sla-policies','workflow-rules']){
  rules[`POST ${base}/${path}`]='settings.manage';rules[`PATCH ${base}/${path}/:id`]='settings.manage';
 }
 for(const action of ['preview','publish','pause','cancel'])rules[`POST ${base}/workflow-rules/:id/${action}`]='settings.manage'
 rules[`PUT ${base}/routing-operators`]='settings.manage'
 rules[`PATCH ${base}/sla-alerts/:id/ack`]='conversations.manage'
 rules[`POST ${base}/workflow-schedules`]='self'
 rules[`PATCH ${base}/workflow-schedules/:id`]='self'
 rules[`POST ${base}/workflow-clock`]='settings.manage'
}

for(const base of [P,D]){
 for(const kind of ['companies','company-fields']){
  const rule=kind==='companies'?'contacts.manage':'settings.manage'
  rules[`GET ${base}/${kind}`]=rule
  rules[`POST ${base}/${kind}`]=rule
 }
 rules[`GET ${base}/companies/:companyId`]='contacts.manage'
 rules[`PATCH ${base}/companies/:companyId`]='contacts.manage'
 for(const method of ['PUT','DELETE'])rules[`${method} ${base}/companies/:companyId/members/:contactId`]='contacts.manage'
 for(const tail of ['merge/preview','merge','history/:historyId/undo'])rules[`POST ${base}/companies/:companyId/${tail}`]='contacts.manage'
 for(const method of ['PATCH','DELETE'])rules[`${method} ${base}/company-fields/:fieldId`]='settings.manage'
 for(const tail of ['preview',':runId/apply',':runId/undo'])rules[`POST ${base}/customer-imports/${tail}`]='data.import'
 rules[`GET ${base}/customer-imports/:runId`]='data.import'
}

const prefixes=['/api/v1/','/api/management/admin/']
for(const base of [P,D])rules[`POST ${base}/tickets`]='conversations.reply'
for(const action of ['connect','imap'])rules[`POST ${P}/mailboxes/${action}`]='integrations.install'
rules[`POST ${P}/mailboxes`]='integrations.install'
rules[`PATCH ${P}/mailboxes/:mailboxId`]='settings.manage'
rules[`DELETE ${P}/mailboxes/:mailboxId`]='integrations.install'
for(const action of ['reconnect','aliases','poll','backfill'])rules[`POST ${P}/mailboxes/:mailboxId/${action}`]='integrations.install'
rules[`DELETE ${P}/mailboxes/:mailboxId/aliases/:alias`]='integrations.install'
rules[`PUT ${P}/mailboxes/:mailboxId/signatures/:agentId`]='settings.manage'
rules[`POST ${P}/suspended/:id/recover`]='conversations.manage'
rules[`DELETE ${P}/suspended/:id`]='conversations.manage'
rules[`POST ${P}/sender-rules`]='settings.manage'
export function routeRule(method:string,path:string):Rule|undefined{
 if(path==='/api/voice/hooks/:numberId')return 'none'
 if(path.startsWith('/api/voice/projects/:projectId/')){
  if(path.endsWith('/report'))return 'reports.view'
  if(path.endsWith('/context-link')||path.endsWith('/context-candidates'))return 'contacts.manage'
  if(path.endsWith('/withdraw'))return 'conversations.manage'
  if(path.includes('/conversations/'))return method==='GET'?'conversations.manage':'conversations.reply'
  return 'integrations.install'
 }
 if(path==='/api/escalations/webhooks/:connectionId'||path==='/api/escalations/attachments/:token')return 'none'
 if(path.startsWith('/api/escalations/projects/:projectId/')){
  if(method==='GET')return 'self'
  if(path.endsWith('/connections'))return 'integrations.install'
  if(path.endsWith('/send'))return 'conversations.reply'
  return 'conversations.manage'
 }
 if(prefixes.some(prefix=>path.startsWith(prefix)))return 'none'
 return r4RouteRule(method,path)??rules[`${method} ${path}`]??selfServiceRules[`${method} ${path}`]
}
