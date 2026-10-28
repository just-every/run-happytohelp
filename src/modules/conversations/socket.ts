import {ticketScopeSql} from '../access/ticket-scope'
import {DurableObject} from 'cloudflare:workers'
import type {Env} from '../../platform/env'
import {hashToken} from '../../platform/auth'
import {pendingFactor,policyRoles,type FactorMethod} from '../identity/two-factor/state'
import {mergePresence,presenceFrame,teammateOnline,ONLINE_IDLE_REPORT_MAX_MS,PRESENCE_SWEEP_MS,PRESENCE_TTL_MS,type OnlineState,type SocketAttachment as Attachment,type SocketActor} from '../collaboration/presence'
import {recordOnline} from '../collaboration/presence-store'

export class ConversationSocket extends DurableObject<Env>{
 async authorized(a:Attachment):Promise<SocketActor|null>{
  const scope=a.projectId?'EXISTS(SELECT 1 FROM memberships target WHERE target.user_id=s.actor_id AND target.project_id=?) AND s.role<>\'contact\'':`EXISTS(SELECT 1 FROM conversations c WHERE c.id=? AND c.project_id=s.project_id AND (s.role<>'contact' AND ${ticketScopeSql('s.actor_id')} OR s.role='contact' AND s.contact_id=c.contact_id AND EXISTS(SELECT 1 FROM contacts ct WHERE ct.id=c.contact_id AND COALESCE(json_extract(ct.metadata_json,'$.is_blocked'),0)!=1)))`
  const row=await this.env.DB.prepare(`SELECT s.actor_id,s.role,u.name,s.project_id,sf.verified_at factorAt,sf.method factorMethod,
   EXISTS(SELECT 1 FROM user_factors f WHERE f.user_id=s.actor_id AND f.confirmed_at IS NOT NULL) hasFactor,
   (SELECT json_extract(ps.settings_json,'$.two_factor_roles') FROM project_settings ps WHERE ps.project_id=s.project_id) twoFactorRoles,
   (SELECT CASE WHEN mr.role_key='collaborator' OR pr.base='collaborator' THEN 'collaborator' END FROM member_roles mr LEFT JOIN project_roles pr ON pr.id=mr.role_key AND pr.project_id=mr.project_id WHERE mr.project_id=s.project_id AND mr.user_id=s.actor_id) policyRole
   FROM sessions s LEFT JOIN users u ON u.id=s.actor_id LEFT JOIN session_factors sf ON sf.token_hash=s.token_hash
   WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND ${scope}
   AND (s.role='contact' OR EXISTS(SELECT 1 FROM memberships live WHERE live.user_id=s.actor_id AND live.project_id=s.project_id AND live.role=s.role))
   AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=COALESCE(?,s.project_id) AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL)`)
   .bind(a.tokenHash,Date.now(),a.projectId||a.conversationId,a.projectId??null).first<SocketActor&{project_id:string;factorAt:number|null;factorMethod:FactorMethod|null;hasFactor:number;twoFactorRoles:string|null;policyRole:string|null}>()
  if(!row)return null
  if(row.role!=='contact'&&pendingFactor({factorAt:row.factorAt,factorMethod:row.factorMethod,hasFactor:!!row.hasFactor,required:policyRoles(row.twoFactorRoles).includes(row.policyRole||row.role),installation:row.factorMethod==='installation'}))return null
  return row
 }
 async replay(ws:WebSocket){
  const a=ws.deserializeAttachment() as Attachment,actor=await this.authorized(a)
  if(!actor){await this.releaseOnline(ws);ws.close(1008,'Session revoked');return}
  const rows=await this.env.DB.prepare(`SELECT o.id eventId,m.* FROM conversation_outbox o JOIN messages m ON m.id=o.message_id JOIN conversations c ON c.id=o.conversation_id AND c.project_id=o.project_id WHERE ${a.projectId?'o.project_id':'o.conversation_id'}=? AND o.id>? ${actor.role==='contact'?'':`AND ${ticketScopeSql('?')}`} ORDER BY o.id LIMIT 500`).bind(a.projectId||a.conversationId,a.cursor,...(actor.role==='contact'?[]:[actor.actor_id])).all()
  for(const row of rows.results){
   if(actor.role==='contact')delete row.content_raw
   row.media=(await this.env.DB.prepare('SELECT id,filename,content_type,size FROM media WHERE message_id=?').bind(row.id).all()).results
   ws.send(JSON.stringify({type:a.projectId?'conversation':'message',eventId:row.eventId,conversationId:row.conversation_id,message:row}));a.cursor=Number(row.eventId)
  }
  const latest=ws.deserializeAttachment() as Attachment
  ws.serializeAttachment({...latest,cursor:Math.max(latest.cursor,a.cursor)})
 }
 async publishPresence(exclude?:WebSocket){
  const sockets=this.ctx.getWebSockets().filter(ws=>ws!==exclude),peers=[],receivers:WebSocket[]=[]
  let conversationId:string|undefined,hasPresence=false
  for(const ws of sockets){
   const a=ws.deserializeAttachment() as Attachment
   if(!a.conversationId)continue
   conversationId=a.conversationId
   const actor=await this.authorized(a)
   if(!actor){delete a.presence;ws.serializeAttachment(a);ws.close(1008,'Session revoked');continue}
   if(actor.role==='contact')continue
   receivers.push(ws)
   if(a.presence&&a.presence.expiresAt<=Date.now()){delete a.presence;ws.serializeAttachment(a)}
   if(a.presence){hasPresence=true;peers.push({id:actor.actor_id,name:actor.name||'Teammate',...a.presence})}
  }
  if(conversationId){const frame=JSON.stringify(presenceFrame(conversationId,mergePresence(peers)));for(const ws of receivers)try{ws.send(frame)}catch{ws.close(1011,'Delivery failed')}}
  // Keep checking authorization even after a peer expires, until the operator disconnects.
  if(hasPresence||receivers.length)await this.ctx.storage.setAlarm(Date.now()+PRESENCE_SWEEP_MS)
 }
 async alarm(){await this.publishPresence()}
 /** Workspace presence (project stream only): one teammate across every stream of theirs this object holds, recorded
  * for availability. A failed write is logged; the next heartbeat writes again and an unrefreshed row expires. */
 async syncOnline(projectId:string,userId:string,exclude?:WebSocket){
  const now=Date.now(),states=this.ctx.getWebSockets().filter(ws=>ws!==exclude).map(ws=>(ws.deserializeAttachment() as Attachment).online).filter((state):state is OnlineState=>state?.userId===userId)
  try{await recordOnline(this.env,projectId,userId,teammateOnline(states,now),now)}catch{console.error('Workspace presence write failed; it is retried on the next heartbeat')}
 }
 async releaseOnline(ws:WebSocket){
  const a=ws.deserializeAttachment() as Attachment
  if(!a.projectId||!a.online)return
  const userId=a.online.userId;delete a.online
  try{ws.serializeAttachment(a)}catch{}
  await this.syncOnline(a.projectId,userId,ws)
 }
 async fetch(request:Request){
  const url=new URL(request.url)
  if(url.pathname==='/event'){
   const event=await request.json() as {conversationId:string;[key:string]:unknown}
   for(const ws of this.ctx.getWebSockets()){
    const a=ws.deserializeAttachment() as Attachment
    if(a.conversationId&&a.conversationId!==event.conversationId||a.projectId&&a.projectId!==event.projectId)continue
    const actor=await this.authorized(a)
    if(!actor){await this.releaseOnline(ws);ws.close(1008,'Session revoked');continue}
    if(event.operatorOnly===true&&actor.role==='contact')continue
    if(actor.role!=='contact'&&!await this.env.DB.prepare(`SELECT 1 FROM conversations c WHERE c.id=? AND ${ticketScopeSql('?')}`).bind(event.conversationId,actor.actor_id).first())continue
    ws.send(JSON.stringify(event))
   }
   return new Response('ok')
  }
  if(url.pathname==='/broadcast'){for(const ws of this.ctx.getWebSockets())try{await this.replay(ws)}catch{await this.releaseOnline(ws);ws.close(1011,'Delivery failed')}return new Response('ok')}
  if(request.headers.get('Upgrade')!=='websocket')return new Response('WebSocket required',{status:426})
  const conversationId=request.headers.get('X-Conversation-Id'),projectId=request.headers.get('X-Project-Id'),token=request.headers.get('X-Session-Token')
  if((!conversationId&&!projectId)||!token)return new Response('Unauthorized',{status:401})
  const a:Attachment={conversationId:conversationId||undefined,projectId:projectId||undefined,tokenHash:await hashToken(token),cursor:Math.max(0,Number(url.searchParams.get('after'))||0)}
  const actor=await this.authorized(a)
  if(!actor)return new Response('Unauthorized',{status:401})
  if(conversationId&&actor.role!=='contact')a.presence={expiresAt:Date.now()+PRESENCE_TTL_MS,typing:false,draft:false}
  const pair=new WebSocketPair();this.ctx.acceptWebSocket(pair[1]);pair[1].serializeAttachment(a)
  await this.replay(pair[1]);if(a.presence)await this.publishPresence()
  return new Response(null,{status:101,webSocket:pair[0]})
 }
 async webSocketMessage(ws:WebSocket,message:string|ArrayBuffer){
  if(typeof message!=='string'||message.length>4096){ws.close(1003,'Invalid command');return}
  let command:any;try{command=JSON.parse(message)}catch{ws.close(1003,'Invalid JSON');return}
  if(!command||typeof command!=='object')return
  const a=ws.deserializeAttachment() as Attachment,actor=await this.authorized(a)
  if(!actor){await this.releaseOnline(ws);ws.close(1008,'Session revoked');await this.publishPresence(ws);return}
  // On the project stream, presence is the workspace's: how long this person has been idle, as their dashboard saw it.
  if(command.type==='presence'&&a.projectId&&!a.conversationId){
   if(typeof command.idleMs!=='number'||!Number.isFinite(command.idleMs)){await this.releaseOnline(ws);ws.close(1003,'Invalid command');return}
   const now=Date.now();a.online={userId:actor.actor_id,activeAt:now-Math.min(Math.max(command.idleMs,0),ONLINE_IDLE_REPORT_MAX_MS),seenAt:now}
   ws.serializeAttachment(a);await this.syncOnline(a.projectId,actor.actor_id);return
  }
  if(command.type==='presence'){
   if(actor.role==='contact'||!a.conversationId){ws.close(1008,'Operator conversation required');return}
   if(command.viewing===false)delete a.presence
   else a.presence={expiresAt:Date.now()+PRESENCE_TTL_MS,typing:command.typing===true,draft:command.draft===true}
   ws.serializeAttachment(a);await this.publishPresence();return
  }
  if(command.type==='replay'||command.type==='ping'){await this.replay(ws);ws.send(JSON.stringify({type:'pong'}))}
 }
 async webSocketClose(ws:WebSocket,code:number,reason:string){await this.releaseOnline(ws);ws.close([1005,1006,1015].includes(code)?1000:code,reason);await this.publishPresence(ws)}
 async webSocketError(ws:WebSocket){await this.releaseOnline(ws);ws.close(1011,'Socket error');await this.publishPresence(ws)}
}
