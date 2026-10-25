import {uploadApi} from './api-upload'
import {conversationBounds} from './bounds'
import {appendApi} from './api-append'
import {createApi} from './api-create'
import {publishResolution} from '../outcomes/state'
import {contactAvailableSql} from '../conversations/contact-privacy'
import {HTTPException} from 'hono/http-exception'
import type {Hono} from 'hono'
import {admitMessage,reservedLocalId} from '../conversations/admission'
import {transitionConversation} from '../outcomes/resolve'
import {applyMessageEffects} from '../../message-effects'
import {type ApiEnv,requireScope,iso,page,jsonBody} from './http'
import {getTicket,fieldAllowed,fieldData} from '../tickets/model'
import {mutateTicket} from '../tickets/mutate'
import {ticketPresentation} from '../tickets/presentation'
export function conversationApi(app:Hono<ApiEnv>){
 createApi(app)
 uploadApi(app)
 appendApi(app)
 const read=requireScope('conversations:read')
 app.get('/ticket-fields',read,async c=>{const a=c.get('authority'),rows=await c.env.DB.prepare('SELECT * FROM ticket_fields WHERE project_id=? ORDER BY name,id').bind(a.projectId).all<any>();return c.json({data:rows.results.filter(field=>fieldAllowed(field,null)).map(field=>fieldData(field,null))})})
 app.get('/ticket-statuses',read,async c=>{const a=c.get('authority');return c.json({data:(await c.env.DB.prepare('SELECT id,name,category,active FROM ticket_statuses WHERE project_id=? ORDER BY category,name,id').bind(a.projectId).all()).results})})
 app.get('/ticket-groups',read,async c=>{const a=c.get('authority');return c.json({data:(await c.env.DB.prepare('SELECT id,name FROM ticket_groups WHERE project_id=? ORDER BY name,id').bind(a.projectId).all()).results})})
 async function conversation(c:any){const a=c.get('authority'),row=await c.env.DB.prepare(`SELECT c.* FROM conversations c WHERE c.id=? AND c.project_id=? AND ${contactAvailableSql()} AND ${conversationBounds()}`).bind(c.req.param('id'),a.projectId,a.tokenId).first();if(!row)throw new HTTPException(404,{message:'Not found'});return row}
 app.get('/conversations',read,async c=>{
  const a=c.get('authority'),q=c.req.query(),status=q.status||'all',since=q.updated_since?Date.parse(q.updated_since):null,tag=q.tag||null
  if(!['open','resolved','all'].includes(status)||since!==null&&!Number.isFinite(since)||tag&&tag.length>200)throw new HTTPException(400,{message:'Invalid conversation filter'})
  const ticketFilters=Object.fromEntries(['status_id','status_category','priority','subject','channel','brand_id','group_id','requester_id','submitter_id','submitter_type'].filter(key=>q[key]!==undefined).map(key=>[key,q[key]]))
  const paging=page(q,{project:a.projectId,resource:'conversations',status,since,tag,ticketFilters}),pred=['c.project_id=?',contactAvailableSql(),conversationBounds()],params:any[]=[a.projectId,a.tokenId]
  if(status!=='all')pred.push(`c.status_category ${status==='open'?'NOT ':''}IN ('solved','closed')`)
  for(const [field,value] of Object.entries(ticketFilters)){if(value.length>500)throw new HTTPException(400,{message:'Invalid ticket filter'});pred.push(`c.${field}=?`);params.push(value)}
  if(since!==null){pred.push('c.updated_at>=?');params.push(since)}
  if(tag){pred.push('EXISTS(SELECT 1 FROM conversation_tags t JOIN workspace_tags w ON w.id=t.tag_id AND w.project_id=t.project_id WHERE t.conversation_id=c.id AND t.project_id=c.project_id AND (w.id=? OR w.name=?))');params.push(tag,tag)}
  if(paging.cursor){pred.push('(c.updated_at<? OR (c.updated_at=? AND c.id<?))');params.push(paging.cursor.time,paging.cursor.time,paging.cursor.id)}
  const rows=await c.env.DB.prepare(`SELECT c.* FROM conversations c WHERE ${pred.join(' AND ')} ORDER BY c.updated_at DESC,c.id DESC LIMIT ?`).bind(...params,paging.size+1).all()
  const result=paging.finish(rows.results,'updated_at'),details=await ticketPresentation(c.env,rows.results.slice(0,paging.size))
  return c.json({...result,data:result.data.map(row=>({...row,...details.get(row.id)}))})
 })
 app.get('/conversations/:id',read,async c=>{await conversation(c);const a=c.get('authority');return c.json({data:iso(await getTicket(c.env,{id:'api:'+a.tokenId,projectId:a.projectId,role:'operator'},c.req.param('id'),a))})})
 app.patch('/conversations/:id',requireScope('conversations:write'),async c=>{
  await conversation(c);const a=c.get('authority'),body=await jsonBody(c)
  const data=await mutateTicket(c.env,{id:'api:'+a.tokenId,projectId:a.projectId,role:'operator'},c.req.param('id'),body,{tokenAuthority:a,source:'api'})
  return c.json({data:iso(data)})
 })
 app.get('/conversations/:id/messages',read,async c=>{const row=await conversation(c),q=c.req.query(),p=page(q,{project:row.project_id,resource:'messages',conversation:row.id}),args:any[]=[row.project_id,row.id];if(p.cursor)args.push(p.cursor.time,p.cursor.time,p.cursor.id);const rows=await c.env.DB.prepare(`SELECT * FROM messages WHERE project_id=? AND conversation_id=? AND erased_at IS NULL AND EXISTS(SELECT 1 FROM conversations c WHERE c.id=messages.conversation_id AND c.project_id=messages.project_id AND ${contactAvailableSql()}) ${p.cursor?'AND (revision<? OR (revision=? AND id<?))':''} ORDER BY revision DESC,id DESC LIMIT ?`).bind(...args,p.size+1).all();return c.json({...p.finish(rows.results,'revision'),revision:row.revision,last_message_id:row.last_message_id})})
 app.post('/conversations/:id/messages',requireScope('messages:write'),async c=>{
  const current=await conversation(c),a=c.get('authority'),b=await jsonBody(c)
  if(typeof b.localId!=='string'||!b.localId||b.localId.length>200||typeof b.content!=='string'||!b.content.trim()||b.content.length>100000||!Number.isSafeInteger(b.expectedRevision)||b.expectedRevision<0||reservedLocalId(b.localId)||b.authoring!==undefined||b.generationId!==undefined||b.resolve!==undefined)throw new HTTPException(400,{message:'Invalid API reply command'})
  const actor={id:'api:'+a.tokenId,projectId:a.projectId,role:'operator' as const}
  const result=await admitMessage(c.env,{actor,projectId:a.projectId,conversationId:current.id,localId:b.localId,content:b.content,expectedRevision:b.expectedRevision,expectedLastMessageId:b.expectedLastMessageId,tokenAuthority:a})
  if(!result.accepted)throw new HTTPException(409,{message:'Conversation or authority changed'})
  if(!result.duplicate)c.executionCtx.waitUntil(applyMessageEffects(c.env,result.message!,actor))
  c.executionCtx.waitUntil(Promise.all([publishResolution(c.env,a.projectId,current.id),...[current.id,`project:${a.projectId}`].map(key=>c.env.CONVERSATIONS.get(c.env.CONVERSATIONS.idFromName(key)).fetch('https://conversation.internal/broadcast',{method:'POST'}))]))
  return c.json({data:iso(result.message),duplicate:result.duplicate})
 })
 app.post('/conversations/:id/resolve',requireScope('conversations:write'),async c=>{await conversation(c);const a=c.get('authority');return c.json({data:await transitionConversation(c.env,{id:'api:'+a.tokenId,projectId:a.projectId,role:'operator'},c.req.param('id'),{resolved:true},undefined,a)})})
}
