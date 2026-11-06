import {MobileMemory,clearMemory,type MobileCredential,type MobileSession,type TicketSnapshot,type MobileDraft,type DraftFile,type ConnectionState,type PurgeReason,type MobileApproval,type MobileApprovalReceipt} from './client-state'
import {MobileClientError,MobileTransport,type MobileFetch} from './client-transport'
import type {MobileScope} from './authority'
import type {Authoring} from '../outcomes/provenance'
export {MobileClientError} from './client-transport'
export type {MobileCredential,MobileSession,TicketSnapshot,MobileDraft,ConnectionState,PurgeReason,MobileApproval,MobileApprovalReceipt} from './client-state'
const json=(body:unknown):RequestInit=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
const ticketPath=(id:string)=>'/tickets/'+encodeURIComponent(id)

/** Portable, process-memory-only mobile controller. Native hosts must connect
 * their authority, workspace and termination events to the lifecycle methods.
 * The web inbox does not use this controller or inherit its proof. */
export class MobileClient {
 #memory=new MobileMemory()
 #transport:MobileTransport
 #state:ConnectionState='reconnect-required'
 #purgeReason:PurgeReason|null=null
 #epoch=0
 #listeners=new Set<()=>void>()
 #lifecycle:EventTarget|undefined
 #onOffline=()=>this.setOffline()
 #onOnline=()=>{if(this.#state==='offline'){this.#state='reconnect-required';this.#notify()}}
 #onExit=()=>this.dispose()
 constructor({origin,credential,fetch:fetcher=globalThis.fetch.bind(globalThis),lifecycle=typeof window==='undefined'?undefined:window}:{origin:string;credential:MobileCredential;fetch?:MobileFetch;lifecycle?:EventTarget}){
  this.#transport=new MobileTransport(origin,credential,fetcher,reason=>this.purge(reason),()=>this.setOffline())
  this.#lifecycle=lifecycle
  lifecycle?.addEventListener('offline',this.#onOffline)
  lifecycle?.addEventListener('online',this.#onOnline)
  lifecycle?.addEventListener('pagehide',this.#onExit)
 }
 get state(){this.#checkExpiry();return {connection:this.#state,purgeReason:this.#purgeReason,ticketCount:this.#memory.tickets.size,draftCount:this.#memory.drafts.size,resourceCount:this.#memory.resources.size}}
 subscribe(listener:()=>void){this.#listeners.add(listener);return ()=>this.#listeners.delete(listener)}
 #notify(){for(const listener of this.#listeners)listener()}
 #checkExpiry(){if(this.#transport.credential&&this.#transport.credential.expiresAt<=Date.now())this.purge('revocation')}
 #requireOnline(scope:MobileScope='read'){
  this.#checkExpiry()
  if(this.#state!=='online')throw new MobileClientError('Reconnect and review before continuing')
  if(!this.#transport.credential?.scopes.includes(scope))throw new MobileClientError('This device does not have permission for this operation',403)
 }
 setOffline(){if(this.#state==='signed-out')return;this.#epoch++;this.#transport.cancel();this.#state='offline';this.#memory.invalidate();this.#notify()}
 purge(reason:PurgeReason){this.#epoch++;this.#transport.purge();this.#memory.purge();this.#state='signed-out';this.#purgeReason=reason;this.#notify()}
 authorityChanged(){this.purge('authority-change')}
 workspaceChanged(){this.purge('workspace-change')}
 dispose(){
  this.#lifecycle?.removeEventListener('offline',this.#onOffline)
  this.#lifecycle?.removeEventListener('online',this.#onOnline)
  this.#lifecycle?.removeEventListener('pagehide',this.#onExit)
  this.purge('process-exit');this.#listeners.clear();this.#lifecycle=undefined
 }
 async signOut(){
  // Start the revocation once, then clear locally before waiting for network.
  const attempt=this.#transport.signOut()
  this.purge('signout')
  return attempt
 }
 async reconnect(){
  if(this.#state==='signed-out')throw new MobileClientError('Sign in again',401)
  const epoch=++this.#epoch
  this.#transport.cancel();this.#memory.invalidate();this.#state='reconnecting';this.#notify()
  try{
   const session=await this.#transport.request<MobileSession>('/session'),credential=this.#transport.credential
   if(!credential||session.projectId!==credential.projectId){this.purge('workspace-change');throw new MobileClientError('Workspace changed. Sign in again.',401)}
   if(session.deviceId!==credential.deviceId||[...session.scopes].sort().join()!==[...credential.scopes].sort().join()){
    this.purge('authority-change');throw new MobileClientError('Authority changed. Sign in again.',401)
   }
   for(const id of new Set([...this.#memory.tickets.keys(),...this.#memory.drafts.keys()]))await this.#refresh(id)
   if(epoch!==this.#epoch)throw new MobileClientError('This session changed',401)
   this.#state='online';this.#notify()
  }catch(error){if(epoch===this.#epoch){this.#state='offline';this.#notify()}throw error}
 }
 cachedTicket(id:string){this.#checkExpiry();return this.#memory.tickets.get(id)}
 draft(id:string){this.#checkExpiry();return this.#memory.drafts.get(id)}
 async #refresh(id:string){
  const epoch=this.#epoch
  try{
   const snapshot=await this.#transport.request<TicketSnapshot>(ticketPath(id))
   if(epoch!==this.#epoch){clearMemory(snapshot);throw new MobileClientError('This session changed',401)}
   clearMemory(this.#memory.tickets.get(id));this.#memory.tickets.set(id,snapshot);return snapshot
  }catch(error){if(error instanceof MobileClientError&&[403,404].includes(error.status))this.#memory.forgetTicket(id);throw error}
 }
 async openTicket(id:string){this.#requireOnline();const snapshot=await this.#refresh(id);this.#memory.invalidate();this.#notify();return snapshot}
 async #resource<T>(key:string,path:string,binary=false){
  const epoch=this.#epoch,value=await this.#transport.request<T>(path,{},binary)
  if(epoch!==this.#epoch){clearMemory(value);throw new MobileClientError('This session changed',401)}
  clearMemory(this.#memory.resources.get(key));this.#memory.resources.set(key,value);return value
 }
 async tickets(){this.#requireOnline();return this.#resource<{tickets:Record<string,unknown>[]}>( 'queue','/tickets')}
 async knowledge(id:string,query=''){
  this.#requireOnline('knowledge');return this.#resource(id+'/knowledge',ticketPath(id)+'/knowledge?q='+encodeURIComponent(query))
 }
 async openLink(link:string){
  this.#requireOnline()
  const url=new URL(link)
  if(url.protocol!=='h2h:'||url.hostname!=='open'||!/^\/[A-Za-z0-9_-]+$/.test(url.pathname)||url.search||url.hash||url.username||url.password||url.port)throw new MobileClientError('Invalid support link',400)
  const route=await this.#transport.request<{projectId:string;ticketId:string;path:string}>('/links/'+encodeURIComponent(url.pathname.slice(1)))
  if(route.projectId!==this.#transport.credential?.projectId){this.purge('workspace-change');throw new MobileClientError('Workspace changed. Sign in again.',401)}
  await this.openTicket(route.ticketId);return route
 }
 saveDraft(id:string,content:string,{resolve=false,mediaIds=[],authoring}:{resolve?:boolean;mediaIds?:string[];authoring?:Authoring}={}){
  this.#checkExpiry()
  const snapshot=this.#memory.tickets.get(id)
  if(!snapshot||this.#state==='signed-out')throw new MobileClientError('Open this ticket before drafting')
  const existing=this.#memory.drafts.get(id)
  if(existing&&existing.outcome!=='unsent'&&existing.outcome!=='refused')throw new MobileClientError('Inspect the ticket before replacing an uncertain send')
  const draft:MobileDraft=existing??{localId:crypto.randomUUID(),content:'',resolve:false,mediaIds:[],files:[],frontier:snapshot.frontier,reviewRequired:true,outcome:'unsent'}
  draft.content=content;draft.resolve=resolve;draft.mediaIds=[...mediaIds];draft.reviewRequired=true
  if(authoring)draft.authoring=authoring
  this.#memory.drafts.set(id,draft);this.#notify();return draft
 }
 stageAttachment(id:string,file:Omit<DraftFile,'mediaId'>){
  const draft=this.draft(id)
  if(!draft||draft.outcome!=='unsent')throw new MobileClientError('Start an unsent draft first')
  if(!file.bytes.byteLength||file.bytes.byteLength>20000000||draft.files.length+draft.mediaIds.length>=20)throw new MobileClientError('Attachment cannot be added',400)
  draft.files.push({...file,bytes:new Uint8Array(file.bytes)});draft.reviewRequired=true;this.#notify()
 }
 reviewDraft(id:string){
  this.#requireOnline('reply');const draft=this.#memory.drafts.get(id),snapshot=this.#memory.tickets.get(id)
  if(!draft||!snapshot||snapshot.frontierExpiresAt<=Date.now()||!['unsent','refused'].includes(draft.outcome))throw new MobileClientError('Refresh and inspect this ticket before sending')
  draft.frontier=snapshot.frontier;draft.reviewRequired=false;draft.outcome='unsent';this.#notify()
 }
 discardDraft(id:string){const draft=this.#memory.drafts.get(id);if(draft?.outcome==='sending')throw new MobileClientError('Wait for the send outcome');clearMemory(draft);this.#memory.drafts.delete(id);this.#notify()}
 async sendDraft(id:string){
  this.#requireOnline('reply');const draft=this.#memory.drafts.get(id),snapshot=this.#memory.tickets.get(id)
  if(!draft||draft.reviewRequired||draft.outcome!=='unsent'||!snapshot||snapshot.frontier!==draft.frontier||snapshot.frontierExpiresAt<=Date.now())throw new MobileClientError('Review the current ticket and draft before sending')
  if(draft.files.length&&!this.#transport.credential?.scopes.includes('attachments'))throw new MobileClientError('This device cannot upload attachments',403)
  draft.outcome='sending';this.#notify()
  try{
   for(const file of draft.files){
    if(file.mediaId)continue
    const uploaded=await this.#transport.request<{id:string}>(ticketPath(id)+'/attachments',{method:'POST',headers:{'Mobile-Frontier':draft.frontier,'Content-Type':file.contentType,'X-Filename':file.filename},body:file.bytes as BodyInit})
    file.mediaId=uploaded.id
   }
   const result=await this.#transport.request<{accepted:boolean;messageId?:string;effects?:string}>(ticketPath(id)+'/reply',json({localId:draft.localId,frontier:draft.frontier,content:draft.content,resolve:draft.resolve,mediaIds:[...draft.mediaIds,...draft.files.map(file=>file.mediaId!)],authoring:draft.authoring??{kind:'human'}}))
   if(!result.accepted)throw new MobileClientError('Reply refused. Refresh and review.',409)
   clearMemory(draft);this.#memory.drafts.delete(id);this.#memory.invalidate();this.#notify();return result
  }catch(error){
   if(this.#memory.drafts.get(id)===draft){draft.outcome=error instanceof MobileClientError&&[400,403,404,409,413,422,429].includes(error.status)?'refused':'uncertain';draft.reviewRequired=true;this.#notify()}
   throw error
  }
 }
 async attachment(id:string,mediaId:string){
  this.#requireOnline();return this.#resource<Uint8Array>(id+'/attachment/'+mediaId,ticketPath(id)+'/attachments/'+encodeURIComponent(mediaId),true)
 }
 async assign(id:string,assignee:string|null){return this.#change(id,'assignment','assign',{assignee})}
 async note(id:string,content:string,mediaIds:string[]=[]){return this.#change(id,'notes','notes',{content,mediaIds})}
 async approvals(id:string){
  this.#requireOnline('approval');return this.#resource<{approvals:MobileApproval[]}>(id+'/approvals',ticketPath(id)+'/approvals')
 }
 async approveFollowUp(id:string,jobId:string,proposalId:string){
  this.#requireOnline('approval');const snapshot=this.#memory.tickets.get(id)
  if(!snapshot)throw new MobileClientError('Refresh this ticket before approving')
  const result=await this.#transport.request<{receipt:MobileApprovalReceipt}>(ticketPath(id)+'/approvals/'+encodeURIComponent(jobId)+'/follow-ups/'+encodeURIComponent(proposalId),json({frontier:snapshot.frontier}))
  this.#memory.invalidate();this.#notify();return result
 }
 async adoptReply(id:string,jobId:string,proposalId:string|null){
  this.#requireOnline('approval');const snapshot=this.#memory.tickets.get(id)
  if(!snapshot)throw new MobileClientError('Refresh this ticket before adopting a reply')
  const result=await this.#transport.request<{draft:{body:string;attachments:{id:string}[];authoring:Authoring}}>(ticketPath(id)+'/approvals/'+encodeURIComponent(jobId)+'/draft',json({frontier:snapshot.frontier,proposalId}))
  return this.saveDraft(id,result.draft.body,{mediaIds:result.draft.attachments.map(file=>file.id),authoring:result.draft.authoring})
 }
 async #change(id:string,tail:string,scope:MobileScope,body:Record<string,unknown>){
  this.#requireOnline(scope);const snapshot=this.#memory.tickets.get(id)
  if(!snapshot||snapshot.frontierExpiresAt<=Date.now())throw new MobileClientError('Refresh this ticket before continuing')
  try{return await this.#transport.request(ticketPath(id)+'/'+tail,json({...body,frontier:snapshot.frontier,localId:crypto.randomUUID()}))}
  finally{this.#memory.invalidate();clearMemory(this.#memory.tickets.get(id));this.#memory.tickets.delete(id);this.#notify()}
 }
}
