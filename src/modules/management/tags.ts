import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {requireActor} from '../../platform/auth'
import {dashboardAccess} from './dashboard'
import {mutateTicket} from '../tickets/mutate'
import {ticketAuthority,availableTicketSql} from '../tickets/model'
import {tagKey} from '../move-in/readers/common'
export const tags=new Hono<AppEnv>()
tags.get('/projects/:projectId/tags',async c=>{const actor=await requireActor(c);if(actor.role==='contact')throw new HTTPException(403);const project=c.req.param('projectId');if(!await c.env.DB.prepare('SELECT 1 FROM memberships WHERE project_id=? AND user_id=?').bind(project,actor.id).first())throw new HTTPException(404);return c.json({data:(await c.env.DB.prepare('SELECT id,name FROM workspace_tags WHERE project_id=? ORDER BY normalized_name').bind(project).all()).results})})
const path='/projects/:projectId/conversations/:conversationId/tags'
tags.post(path,async c=>{const {actor,conversation}=await dashboardAccess(c),body=await c.req.json(),requested=body.tagId??body.tag_id;let tag:any
 if(requested){tag=await c.env.DB.prepare('SELECT id,name FROM workspace_tags WHERE project_id=? AND id=?').bind(actor.projectId,requested).first();if(!tag)throw new HTTPException(404)}
 else {const name=typeof body.name==='string'?body.name.trim():'';if(!name||name.length>80)throw new HTTPException(400,{message:'Tag names must contain 1–80 characters'});const normalized=tagKey(name),guard=await ticketAuthority(c.env,actor,{sessionHash:c.get('sessionHash'),source:'dashboard'},'conversations.manage',conversation.id);if(conversation.status_category==='closed')throw new HTTPException(409,{message:'Closed tickets are final'});await c.env.DB.prepare(`INSERT INTO workspace_tags(id,project_id,name,normalized_name) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM conversations c WHERE c.id=? AND c.project_id=? AND c.status_category<>'closed' AND ${availableTicketSql()}) AND EXISTS(${guard.sql}) ON CONFLICT(project_id,normalized_name) DO NOTHING`).bind(crypto.randomUUID(),actor.projectId,name,normalized,conversation.id,actor.projectId,...guard.params).run();tag=await c.env.DB.prepare('SELECT id,name FROM workspace_tags WHERE project_id=? AND normalized_name=?').bind(actor.projectId,normalized).first();if(!tag)throw new HTTPException(409,{message:'Ticket or authority changed. Refresh before adding a tag.'})}
 await mutateTicket(c.env,actor,conversation.id,{tags_add:[tag.id]},{sessionHash:c.get('sessionHash'),source:'dashboard'});return c.json({data:tag},201)})
tags.delete(`${path}/:tagId`,async c=>{const {actor,conversation}=await dashboardAccess(c),tag=c.req.param('tagId');if(!await c.env.DB.prepare('SELECT id FROM workspace_tags WHERE project_id=? AND id=?').bind(actor.projectId,tag).first())throw new HTTPException(404);await mutateTicket(c.env,actor,conversation.id,{tags_remove:[tag]},{sessionHash:c.get('sessionHash'),source:'dashboard'});return c.json({removed:true})})
