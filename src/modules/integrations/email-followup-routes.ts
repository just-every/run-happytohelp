import {ticketScopeSql,requireTicketScope} from '../access/ticket-scope'
import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {scope} from '../management/common'

export const emailFollowupRoutes=new Hono<AppEnv>()
emailFollowupRoutes.get('/projects/:projectId/conversations/:conversationId/email-followups',async c=>{
 const actor=await scope(c),conversationId=c.req.param('conversationId')
 await requireTicketScope(c.env,actor.id,actor.projectId,conversationId)
 if(!await c.env.DB.prepare('SELECT 1 FROM conversations WHERE id=? AND project_id=?').bind(conversationId,actor.projectId).first())throw new HTTPException(404)
 const rows=(await c.env.DB.prepare(`SELECT link.parent_id,link.conversation_id,c.subject,link.created_at FROM email_followup_links link JOIN conversations c ON c.id=CASE WHEN link.conversation_id=? THEN link.parent_id ELSE link.conversation_id END AND c.project_id=link.project_id WHERE link.project_id=? AND (link.parent_id=? OR link.conversation_id=?) AND ${ticketScopeSql('?')} ORDER BY link.created_at`).bind(conversationId,actor.projectId,conversationId,conversationId,actor.id).all()).results
 return c.json({data:rows})
})
