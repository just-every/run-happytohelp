import {ticketScopeSql} from '../access/ticket-scope'
import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {requireActor} from '../../platform/auth'
import {inboxCounts} from './inbox-counts'
import {scope} from './common'
import {bucketData,bucketsData} from './buckets'
import {conversationData,conversationsData} from './dashboard-data'
import {inboxSearchTerm,inboxSearchCondition,attachMatchedMessages} from './inbox-search'
import {inboxFilters} from './inbox-filters'
import {hasMessages} from './inbox-visible'
import {compileFilters,parseFilters,queryJSON} from '../tickets/filters'
import {compileSort,parseSort} from '../tickets/sort'
import {savedQueue} from '../tickets/views'
export const dashboard=new Hono<AppEnv>()
export async function dashboardAccess(c:any){const actor=await requireActor(c);if(actor.role==='contact')throw new HTTPException(403);const row=await c.env.DB.prepare('SELECT c.*,m.role membership_role FROM conversations c JOIN memberships m ON m.project_id=c.project_id WHERE c.id=? AND m.user_id=? AND EXISTS(SELECT 1 FROM projects p WHERE p.id=c.project_id) AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=c.project_id AND json_extract(ps.settings_json,"$.deleted_at") IS NOT NULL)').bind(c.req.param('conversationId'),actor.id).first();if(!row||c.req.param('projectId')&&row.project_id!==c.req.param('projectId'))throw new HTTPException(404);return {actor:{...actor,projectId:row.project_id,role:row.membership_role},conversation:row}}
for(const prefix of ['/conversations','/projects/:projectId/conversations']){
 dashboard.get(prefix,async c=>{
 const a=await requireActor(c)
 if(a.role==='contact')throw new HTTPException(403)
 const project=c.req.param('projectId')
 if(project)await scope(c)
 const page=Math.max(1,parseInt(c.req.query('page')||'1')||1),search=inboxSearchTerm(c)
 const conditions=["EXISTS(SELECT 1 FROM memberships m WHERE m.project_id=c.project_id AND m.user_id=?)",hasMessages,"NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=c.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL)"],params:any[]=[a.id]
 if(project){conditions.push('c.project_id=?');params.push(project)}
 const saved=await savedQueue(c.env,a,project,c.req.query('saved_view'))
 const requestedFilters=queryJSON(c.req.query('filters'),'filters'),requestedSort=queryJSON(c.req.query('sort'),'sort')
 const structured=saved!==undefined||requestedFilters!==undefined
 const filters=structured?await compileFilters(c.env,a,project,saved?.filters??parseFilters(requestedFilters)):inboxFilters(name=>c.req.query(name),search,a.id)
 conditions.push(...filters.conditions);params.push(...filters.params)
 const sort=await compileSort(c.env,a,project,requestedSort===undefined?saved?.sort??[]:parseSort(requestedSort))
 const company=c.req.query('company')
 if(company){conditions.push('EXISTS(SELECT 1 FROM contact_companies member JOIN companies account ON account.id=member.company_id AND account.project_id=member.project_id WHERE member.project_id=c.project_id AND member.contact_id=c.contact_id AND member.company_id=? AND account.merged_into IS NULL)');params.push(company)}
 const tag=c.req.query('tag')
 if(tag){
  if(!project||!await c.env.DB.prepare('SELECT id FROM workspace_tags WHERE id=? AND project_id=?').bind(tag,project).first())throw new HTTPException(404)
  conditions.push('EXISTS(SELECT 1 FROM conversation_tags ct WHERE ct.conversation_id=c.id AND ct.project_id=c.project_id AND ct.tag_id=?)');params.push(tag)
 }
 if(search){const match=inboxSearchCondition(search);conditions.push(match.sql);params.push(...match.params)}
 const before=c.req.query('last_message_before'),beforeId=c.req.query('last_conversation_before')
 if(before&&beforeId){
  if(saved?.sort.length||requestedSort!==undefined)throw new HTTPException(400,{message:'Use page pagination with a custom sort'})
  const stamp=Date.parse(before);if(!Number.isFinite(stamp))throw new HTTPException(400)
  conditions.push('(coalesce((SELECT created_at FROM messages WHERE id=c.last_message_id),c.updated_at)<? OR (coalesce((SELECT created_at FROM messages WHERE id=c.last_message_id),c.updated_at)=? AND c.id<?))');params.push(stamp,stamp,beforeId)
 }
 const snoozed=c.req.query('snoozed'),sleeping="EXISTS(SELECT 1 FROM workflow_schedules ws WHERE ws.conversation_id=c.id AND ws.kind='snooze' AND ws.state='pending')"
 if(snoozed==='only')conditions.push(sleeping)
 else if(snoozed!=='include'&&(!search||c.req.query('search_scope')==='view'))conditions.push('NOT '+sleeping)
 conditions.push(ticketScopeSql('?'));params.push(a.id)
 const where=conditions.join(' AND '),listing=await c.env.DB.batch<any>([
  c.env.DB.prepare(`SELECT count(*) total FROM conversations c WHERE ${where}`).bind(...params),
  c.env.DB.prepare(`SELECT c.* FROM conversations c WHERE ${where} ORDER BY ${sort.sql} LIMIT 30 OFFSET ?`).bind(...params,...sort.params,(page-1)*30)
 ]),count=listing[0].results[0],rows=listing[1].results,data=await conversationsData(c.env,rows,a.id)
 if(search)await attachMatchedMessages(c.env,search,data)
 return c.json({data,meta:{pagination:{total:count!.total,current_page:page,total_pages:Math.max(1,Math.ceil(count!.total/30))}}})
 })
 dashboard.get(`${prefix}/counts`,async c=>{const a=await requireActor(c);if(a.role==='contact')throw new HTTPException(403);const project=c.req.param('projectId');if(project)await scope(c);const counts=await inboxCounts(c.env,a.id,project);return c.json({data:counts})})
 dashboard.get(`${prefix}/:conversationId`,async c=>{const {actor,conversation}=await dashboardAccess(c);return c.json({data:await conversationData(c.env,conversation,actor.id,true)})})
 dashboard.get(`${prefix}/:conversationId/buckets`,async c=>{
 const {conversation}=await dashboardAccess(c),page=Math.max(1,parseInt(c.req.query('page')||'1')||1)
 const createdBefore=c.req.query('created_before'),stamp=createdBefore?Date.parse(createdBefore):null
 const eligible=`WITH root AS (
 SELECT c.id,c.created_at AS fallback_created_at,(SELECT min(created_at) FROM (
 SELECT created_at FROM messages WHERE conversation_id=c.id AND coalesce(bucket_id,conversation_id)=c.id
 UNION ALL SELECT created_at FROM conversation_notes WHERE conversation_id=c.id
 UNION ALL SELECT e.created_at FROM context_tracked_events e WHERE e.project_id=c.project_id AND e.subject_id=c.contact_id AND json_valid(e.payload) AND json_extract(e.payload,'$.conversation_id')=c.id AND coalesce(json_extract(e.payload,'$.bucket_id'),c.id)=c.id
 )) AS created_at FROM conversations c WHERE c.id=?),buckets AS (
 SELECT id,created_at FROM conversation_buckets WHERE conversation_id=? AND id<>?
 UNION ALL SELECT id,coalesce(created_at,fallback_created_at) FROM root WHERE created_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM conversation_buckets WHERE conversation_id=?))
 SELECT id,created_at FROM buckets${createdBefore?' WHERE created_at<?':''}`
 // Preserve an invalid cursor's empty result while keeping bound values finite.
 const params=[conversation.id,conversation.id,conversation.id,conversation.id,...(createdBefore?[Number.isFinite(stamp)?stamp:-Number.MAX_VALUE]:[])]
 const results=await c.env.DB.batch<any>([
 c.env.DB.prepare(`SELECT count(*) total FROM (${eligible})`).bind(...params),
 c.env.DB.prepare(`${eligible} ORDER BY created_at DESC,id LIMIT 10 OFFSET ?`).bind(...params,(page-1)*10)
 ])
 return c.json({data:await bucketsData(c.env,conversation,results[1].results.map(row=>String(row.id))),meta:{pagination:{current_page:page,total_pages:Math.max(1,Math.ceil(results[0].results[0].total/10))}}})})
 dashboard.get(`${prefix}/:conversationId/buckets/:bucketId`,async c=>{const {conversation}=await dashboardAccess(c),bucket=await bucketData(c.env,conversation,c.req.param('bucketId'));if(!bucket)throw new HTTPException(404);return c.json({data:bucket})})
}
