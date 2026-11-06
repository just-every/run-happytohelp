import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {getTicket} from '../tickets/model'
import {approveFollowUp,followUpSourceSql} from '../local-computer/follow-up'
import {prepareLocalDraft} from '../../edition/local-computer-draft'
import {mobileActor,stillAuthorized} from './authority'
import {frontierGuard,loadFrontier} from './frontier'
import {objectBody} from './commands'

export const mobileApprovalRoutes=new Hono<AppEnv>()
const base='/tickets/:ticketId/approvals'
mobileApprovalRoutes.get(base,async c=>{
 const a=await mobileActor(c,'approval'),ticketId=c.req.param('ticketId')!
 await getTicket(c.env,a.actor,ticketId)
 const rows=await c.env.DB.prepare(`SELECT id,result FROM (${followUpSourceSql.replace('j.id=? AND ','')}) ORDER BY created_at DESC,id LIMIT 100`).bind(a.actor.projectId,ticketId,a.actor.id).all<{id:string;result:string}>()
 const approvals=rows.results.flatMap(row=>{const result=JSON.parse(row.result);return result.verified===true?[{jobId:row.id,summary:result.summary,replies:result.replies??[],followUpActions:(result.follow_up_actions??[]).filter((proposal:{mode:string})=>proposal.mode!=='resolve_reply')}]:[]})
 await stillAuthorized(c.env,a);return c.json({approvals})
})
mobileApprovalRoutes.post(base+'/:jobId/follow-ups/:proposalId',async c=>{
 const a=await mobileActor(c,'approval'),ticketId=c.req.param('ticketId')!,b=objectBody(await c.req.json()),f=await loadFrontier(c.env,a,ticketId,b.frontier)
 await getTicket(c.env,a.actor,ticketId)
 const receipt=await approveFollowUp(c.env,{projectId:a.actor.projectId,conversationId:ticketId,operatorId:a.actor.id,jobId:c.req.param('jobId')!,proposalId:c.req.param('proposalId')!,requireExplicitReply:true,guard:frontierGuard(a,f)})
 await stillAuthorized(c.env,a);return c.json({receipt})
})
mobileApprovalRoutes.post(base+'/:jobId/draft',async c=>{
 const a=await mobileActor(c,'approval'),ticketId=c.req.param('ticketId')!,b=objectBody(await c.req.json()),f=await loadFrontier(c.env,a,ticketId,b.frontier),guard=frontierGuard(a,f)
 if(b.proposalId!==null&&(typeof b.proposalId!=='string'||!b.proposalId||b.proposalId.length>200))throw new HTTPException(400,{message:'Select a reply proposal'})
 await getTicket(c.env,a.actor,ticketId)
 const sourceArgs=[c.req.param('jobId')!,a.actor.projectId,ticketId,a.actor.id],source=await c.env.DB.prepare(followUpSourceSql).bind(...sourceArgs).first<{result:string}>()
 if(!source||JSON.parse(source.result).verified!==true)throw new HTTPException(409,{message:'Verified reply proposal unavailable'})
 guard.sql+=` AND EXISTS(${followUpSourceSql} AND j.result=?)`;guard.params.push(...sourceArgs,source.result)
 const draft=await prepareLocalDraft(c.env,{projectId:a.actor.projectId,conversationId:ticketId,operatorId:a.actor.id,jobId:c.req.param('jobId')!,proposalId:b.proposalId,expectedRevision:f.revision,expectedLastMessageId:f.last_message_id,guard:{sql:guard.sql,args:guard.params}})
 await stillAuthorized(c.env,a)
 return c.json({draft:{...draft,attachments:draft.attachments.map(media=>({...media,url:`/api/mobile/v1/tickets/${encodeURIComponent(ticketId)}/attachments/${encodeURIComponent(String(media.id))}`,preview_url:undefined}))}})
})
