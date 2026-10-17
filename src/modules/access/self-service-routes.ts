import type {Permission} from './catalogue'
const F='/api/forms/projects/:projectId/forms', P='/api/portal/:projectId'
const K='/api/knowledge/:projectId', O='/api/outcomes/projects/:projectId'
/** R7 doors participate in the same custom-role policy as the rest of the desk. */
export const selfServiceRules:Record<string,Permission|'self'|'none'>={
 [`GET ${F}`]:'self',[`GET ${F}/:formId`]:'self',
 [`POST ${F}`]:'settings.manage',[`PUT ${F}/:formId`]:'settings.manage',[`PATCH ${F}/:formId`]:'settings.manage',[`DELETE ${F}/:formId`]:'settings.manage',
 'POST /api/forms/:projectId/:formId/submissions':'none',
 [`POST ${P}/access/request`]:'none',[`POST ${P}/access/logout`]:'none',
 [`POST ${P}/tickets`]:'none',[`POST ${P}/tickets/:ticketId/reply`]:'none',[`POST ${P}/tickets/:ticketId/reopen`]:'none',[`POST ${P}/tickets/:ticketId/attachments`]:'none',
 [`POST ${P}/preferences`]:'none',[`PUT ${P}/preferences`]:'none',
 [`GET ${K}/analytics`]:'reports.view',
 [`GET ${K}/experience`]:'knowledge.edit',
 [`PUT ${K}/experience`]:'knowledge.publish',
 [`PUT ${K}/categories/:categoryId/audience`]:'knowledge.publish',
 [`GET ${K}/articles/:articleId/translations/:locale`]:'knowledge.edit',
 [`PUT ${K}/articles/:articleId/translations/:locale`]:'knowledge.publish',
 [`GET ${K}/articles/:articleId/history`]:'knowledge.edit',
 [`POST ${K}/articles/:articleId/rollback`]:'knowledge.publish',
 [`GET ${K}/conversations/:conversationId/articles`]:'conversations.reply',
 [`POST ${K}/conversations/:conversationId/articles/:articleId/insert`]:'conversations.reply',
 [`GET ${O}/settings`]:'reports.view',
 [`PUT ${O}/settings`]:'settings.manage',
 [`GET ${O}/results`]:'reports.view',
 [`POST ${O}/surveys/:surveyId/revoke`]:'settings.manage',
 'POST /api/knowledge/public/:projectId/access/request':'none',
 'POST /api/knowledge/public/:projectId/access/logout':'none',
 'POST /api/knowledge/public/:projectId/articles/:slug/helpful':'none',
 'POST /api/knowledge/public/:projectId/events':'none',
 'POST /api/outcomes/surveys/:token':'none',
 'POST /api/outcomes/surveys/:token/optout':'none',
}
