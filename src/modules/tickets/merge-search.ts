import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {Actor,AppEnv} from '../../platform/env'
import {scope} from '../management/common'
import {ticketScopeSql} from '../access/ticket-scope'
import {ticketAuthority} from './model'
import {problemAvailableSql} from './problem-model'

export const mergeSearchRoutes=new Hono<AppEnv>()
mergeSearchRoutes.get('/projects/:projectId/ticket-merge-search',async c=>{
 const actor=await scope(c) as Actor,guard=await ticketAuthority(c.env,actor,{sessionHash:c.get('sessionHash')}),q=(c.req.query('q')||'').trim().toLowerCase(),offset=Number(c.req.query('offset')||0)
 if(!q||q.length>200||!Number.isSafeInteger(offset)||offset<0)throw new HTTPException(400,{message:'Enter a requester name, email or ticket subject, up to 200 characters'})
 const rows=await c.env.DB.prepare(`SELECT c.id,c.subject,c.status_category,ct.name requester_name,ct.email requester_email FROM conversations c JOIN contacts ct ON ct.project_id=c.project_id AND ct.id=c.contact_id WHERE c.project_id=? AND c.id<>? AND ${ticketScopeSql('?')} AND ${problemAvailableSql()} AND EXISTS(${guard.sql}) AND (instr(lower(coalesce(c.subject,'')),?)>0 OR instr(lower(coalesce(ct.name,'')),?)>0 OR instr(lower(coalesce(ct.email,'')),?)>0) ORDER BY c.updated_at DESC,c.id LIMIT 31 OFFSET ?`).bind(actor.projectId,c.req.query('exclude')||'',actor.id,...guard.params,q,q,q,offset).all<any>()
 return c.json({data:rows.results.slice(0,30),has_more:rows.results.length>30,offset})
})
