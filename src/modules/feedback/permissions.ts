import type {Permission} from '../access/catalogue'
type Rule=Permission|'self'|'none'
const root='/api/feedback/projects/:projectId',ticket=root+'/conversations/:conversationId',source=ticket+'/sources/:sourceId'
const rules:Record<string,Rule>={
 'POST /api/feedback/releases/:projectId':'none',
 'POST /api/feedback/conversations/:conversationId/opt-out':'self',
 [`GET ${root}/settings`]:'integrations.install',
 [`PUT ${root}/settings`]:'integrations.install',
 [`GET ${root}/penny-connection`]:'integrations.install',
 [`PUT ${root}/penny-connection`]:'integrations.install',
 [`GET ${ticket}`]:'self',
 [`POST ${ticket}`]:'conversations.manage',
 [`GET ${source}/handoff-preview`]:'conversations.manage',
 [`POST ${source}/handoff`]:'conversations.manage',
 [`PUT ${source}/preference`]:'conversations.manage',
 [`POST ${ticket}/updates/:updateId/send`]:'conversations.reply',
}
export const feedbackRouteRule=(method:string,path:string)=>rules[`${method} ${path}`]
