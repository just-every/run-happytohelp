import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv,Env} from '../../platform/env'
import {scope} from '../management/common'
import {requireStepUp} from '../identity/two-factor/step-up'
import {auditStatement,requestSource} from '../audit/record'
import {csv} from './csv'
const positive="(v.scale='thumbs' AND v.score=1 OR v.scale='five' AND v.score>=4)"
const low="(v.scale='thumbs' AND v.score=-1 OR v.scale='five' AND v.score<=3)"
const joins=`FROM conversation_resolutions r LEFT JOIN csat_responses v ON v.resolution_id=r.id AND v.project_id=r.project_id LEFT JOIN csat_surveys s ON s.resolution_id=r.id AND s.project_id=r.project_id LEFT JOIN contacts ct ON ct.id=r.contact_id AND ct.project_id=r.project_id`
const eligible=`r.project_id=? AND (v.resolution_id IS NOT NULL OR s.id IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM move_in_conversations m WHERE m.conversation_id=r.conversation_id) AND NOT EXISTS(SELECT 1 FROM reporting_legacy_conversations l WHERE l.conversation_id=r.conversation_id) AND NOT EXISTS(SELECT 1 FROM legacy_import_rows li WHERE li.target_table='conversations' AND li.target_key=r.conversation_id)`
const erased="ct.id IS NULL OR COALESCE(json_extract(ct.metadata_json,'$.is_erased'),0)=1 OR COALESCE(json_extract(ct.metadata_json,'$.is_erasing'),0)=1"
interface Cursor {at:number;id:string}
function readCursor(raw:string|undefined):Cursor|null{
 if(!raw)return null
 try{const value=JSON.parse(atob(raw));if(Number.isSafeInteger(value.at)&&typeof value.id==='string'&&value.id.length<=100)return value}catch{}
 throw new HTTPException(400,{message:'Invalid results cursor'})
}
async function page(env:Env,projectId:string,lowOnly:boolean,limit:number,cursor:Cursor|null){
 const rows=await env.DB.prepare(`SELECT r.id resolution_id,r.conversation_id,r.ordinal,r.resolved_at,r.reopened_at,s.id survey_id,s.state delivery_state,s.revoked_at,s.expires_at,CASE WHEN v.channel='widget' THEN 'widget' ELSE v.response_surface END channel,v.channel invitation_channel,v.scale,v.score,CASE WHEN ${erased} THEN '' ELSE v.reason END reason,CASE WHEN ${erased} THEN '' ELSE v.comment END comment,v.revision,v.updated_at,CASE WHEN ${erased} THEN 'unknown' ELSE COALESCE(v.recovery,'unknown') END recovery ${joins} WHERE ${eligible} ${lowOnly?`AND ${low}`:''} ${cursor?'AND (r.resolved_at<? OR r.resolved_at=? AND r.id<?)':''} ORDER BY r.resolved_at DESC,r.id DESC LIMIT ?`)
 .bind(projectId,...(cursor?[cursor.at,cursor.at,cursor.id]:[]),limit).all<any>()
 return rows.results
}
const encodeCursor=(row:any)=>btoa(JSON.stringify({at:row.resolved_at,id:row.resolution_id}))
const iso=(at:number|null)=>at===null?null:new Date(at).toISOString()
const present=(row:any)=>({resolutionId:row.resolution_id,conversationId:row.conversation_id,ordinal:row.ordinal,resolvedAt:iso(row.resolved_at),reopenedAt:iso(row.reopened_at),surveyId:row.survey_id,deliveryState:row.delivery_state,revokedAt:iso(row.revoked_at),expiresAt:iso(row.expires_at),response:row.score===null?null:{channel:row.channel,invitationChannel:row.invitation_channel,scale:row.scale,score:row.score,recovery:row.recovery,reason:row.reason,comment:row.comment,revision:row.revision,updatedAt:iso(row.updated_at)}})
export const surveyReports=new Hono<AppEnv>()
surveyReports.get('/projects/:projectId/results',async c=>{
 const actor=await scope(c),lowOnly=c.req.query('lowScore')==='true',rawLimit=c.req.query('limit'),limit=rawLimit===undefined?50:Number(rawLimit),cursor=readCursor(c.req.query('cursor'))
 if(!Number.isInteger(limit)||limit<1||limit>100)throw new HTTPException(400,{message:'Choose a result limit from 1 to 100'})
 c.header('Cache-Control','no-store')
 if(c.req.query('format')){
  if(c.req.query('format')!=='csv')throw new HTTPException(400)
  await requireStepUp(c,actor,'reports.export')
  await auditStatement(c.env.DB,{projectId:actor.projectId,category:'data',action:'csat.results.exported',actor:{type:'user',id:actor.id},source:requestSource(c),detail:{lowScore:lowOnly}}).run()
  const env=c.env,encoder=new TextEncoder();let current:Cursor|null=null,started=false
  return new Response(new ReadableStream({async pull(controller){try{
   if(!started){started=true;controller.enqueue(encoder.encode(csv([['Resolution','Conversation','Cycle','Resolved (UTC)','Reopened (UTC)','Delivery','Channel','Scale','Score','Reason','Comment','Revision','Response (UTC)','Customer recovery']])));return}
   const rows=await page(env,actor.projectId,lowOnly,100,current)
   if(!rows.length){controller.close();return}
   controller.enqueue(encoder.encode(csv(rows.map(row=>[row.resolution_id,row.conversation_id,row.ordinal,iso(row.resolved_at),iso(row.reopened_at),row.delivery_state,row.channel,row.scale,row.score,row.reason,row.comment,row.revision,iso(row.updated_at),row.recovery]))))
   const last=rows[rows.length-1];current={at:last.resolved_at,id:last.resolution_id}
  }catch(error){controller.error(error)}}}),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="satisfaction-surveys.csv"','Cache-Control':'no-store'}})
 }
 const [rows,summary,delivery,optout]=await Promise.all([
  page(c.env,actor.projectId,lowOnly,limit+1,cursor),
  c.env.DB.prepare(`SELECT COUNT(v.resolution_id) rated,COALESCE(SUM(CASE WHEN ${positive} THEN 1 ELSE 0 END),0) positive,COALESCE(SUM(CASE WHEN ${low} THEN 1 ELSE 0 END),0) low_score,COUNT(s.id) invited ${joins} WHERE ${eligible}`).bind(actor.projectId).first<any>(),
  c.env.DB.prepare(`SELECT s.state,COUNT(*) count ${joins} WHERE ${eligible} AND s.id IS NOT NULL GROUP BY s.state`).bind(actor.projectId).all<{state:string;count:number}>(),
  c.env.DB.prepare('SELECT COUNT(*) count FROM csat_optouts WHERE project_id=?').bind(actor.projectId).first<{count:number}>()
 ])
 const more=rows.length>limit,shown=rows.slice(0,limit)
 return c.json({summary:{rated:summary.rated,positive:summary.positive,lowScore:summary.low_score,rate:summary.rated?summary.positive/summary.rated:null,invited:summary.invited,delivery:Object.fromEntries(delivery.results.map(row=>[row.state,row.count])),optedOut:optout?.count||0},results:shown.map(present),nextCursor:more?encodeCursor(shown[shown.length-1]):null,definitions:{timezone:'UTC',recovery:'Explicit customer answer for this exact cycle, independent of satisfaction. Unknown is never inferred from a score. A reopened cycle does not establish current recovery. Feedback never changes ticket status.',unit:'One latest response per exact resolution cycle, including previous and reopened cycles. Imported conversations excluded.',positive:'Thumbs up or 4–5 out of 5.',lowScore:'Thumbs down or 1–3 out of 5. Feedback never closes a complaint.',rate:'Positive responses divided by rated resolution cycles. Invitations without a response are excluded.',delivery:'Sent means provider accepted, not confirmed inbox delivery. Sending and uncertain outcomes are never automatically replayed.'}})
})
