import {createReferenceReadScope} from './reference-read'
import {resolveHelpAccess} from './access'
import {accessReaders} from './door'
import type {Context} from 'hono'
import type {AppEnv,Env} from '../../platform/env'
import {readerSet,memberReaders,anonymousReaders,type Readers} from './door'
import {currentTicketReaders} from './readers'
import {updateKnowledgeIndex} from './canonicaliser'
import {canonicaliseResponse,responseConversation} from './http-copies'
import {renderKnowledgeFields,referenceIds,referenceVisibility,needsKnowledgeRendering} from './reference-store'
import {knowledgeWriteEnvironment} from './write-boundary'
import {dispatchKnowledgeUpgrades} from './upgrade-progress'
import {requireActor} from '../../platform/auth'
const readySchemas=new WeakSet<object>()
// Signing in reads and writes no knowledge row, so a pending content upgrade never holds it: an imported owner has no
// password and enters by the emailed link. Every other route stays fenced; add a path here only after reading it touches no knowledge data.
const identityEntry=new Set(['session','login','setup','auth-options','sign-in-options','magic-link','magic-link/consume'].map(name=>'/api/identity/'+name))
// Cache only an observed schema. A concurrent request owns its own D1 operation.
export async function knowledgeSchemaReady(env:Env){
 const db=env.DB
 if(readySchemas.has(db))return true
 try{
  // Preparing the statement verifies the table even when it has no rows.
  await db.prepare('SELECT 1 FROM knowledge_reply_blocks LIMIT 0').first()
 }catch(error){
  if(error instanceof Error && /\bno such table: (?:main\.)?knowledge_reply_blocks\b/.test(error.message))return false
  throw error
 }
 readySchemas.add(db)
 return true
}

// JSON columns can themselves contain encoded references, and the renderer
// also normalizes their JSON. Empty canonical containers are already final.
function needsProjection(value:unknown):boolean{
 if(typeof value==='string')return value!=='{}'&&value!=='[]'&&needsKnowledgeRendering(value)
 if(!value||typeof value!=='object')return false
 if(Array.isArray(value))return value.some(needsProjection)
 for(const [key,item] of Object.entries(value)){
  if(key==='__proto__'||key==='knowledge_citation'||key==='knowledge_provenance'||needsKnowledgeRendering(key)||needsProjection(item))return true
 }
 return false
}

/** HTTP's shared door covers all text-bearing fields, including JSON columns and
 * nested list/preview responses. Controller authorization still owns ticket access. */
export async function knowledgeHttpDoor(c:Context<AppEnv>,next:()=>Promise<void>){
 // This Boolean deployment probe has no knowledge fields or writes.
 if(c.req.path==='/api/identity/setup-status'){await next();return}
 // Uploaded message files are the author's material. Their native ticket and
 // private-note access rules also apply while stored text is being upgraded.
 if(/^\/api\/(?:conversations\/[^/]+\/media(?:\/[^/]+)?|portal\/[^/]+\/tickets\/[^/]+\/attachments(?:\/[^/]+)?|(?:management|dashboard)\/projects\/[^/]+\/media)$/.test(c.req.path)){await next();return}
 const rawEnv=c.env
 if(!await knowledgeSchemaReady(rawEnv)){await next();return}
 const context=()=>{const actor=c.get('actor'),authority=(c as any).get('authority');return {projectId:c.req.param('projectId')||c.req.param('project')||authority?.projectId||actor?.projectId,authorContactId:actor?.role==='contact'?actor.contactId||actor.id:undefined,conversationId:c.req.param('conversationId')||(/\/conversations\//.test(c.req.path)?c.req.param('id'):undefined)}}
 c.env=knowledgeWriteEnvironment(c.env,context)
 const requestedProject=context().projectId
 const pending=await (requestedProject
  ?rawEnv.DB.prepare('SELECT project_id FROM knowledge_upgrade_reports WHERE completed_at IS NULL AND project_id=?').bind(requestedProject)
  :rawEnv.DB.prepare('SELECT project_id FROM knowledge_upgrade_reports WHERE completed_at IS NULL ORDER BY project_id LIMIT 1')).first<{project_id:string}>()
 if(pending&&!identityEntry.has(c.req.path)){
  let member=false
  const credential=c.req.header('Authorization')?.replace(/^Bearer /,'')||c.req.header('Cookie')?.match(/(?:^|;\s*)h2h_session=([^;]+)/)?.[1]
  if(credential&&!/^int_[a-f0-9]{64}$/.test(credential))try{const actor=await requireActor(c);member=actor.role!=='contact'&&Boolean(await rawEnv.DB.prepare('SELECT 1 FROM memberships WHERE user_id=? AND project_id=?').bind(actor.id,requestedProject||actor.projectId).first())}catch{}
  // Only the maintenance response wakes recovery here. Member commands leave
  // upgrade dispatch to the scheduler, so a refusal performs no unrelated writes.
  if(!member){await dispatchKnowledgeUpgrades(rawEnv);c.header('Retry-After','1');c.header('Cache-Control','no-store');return c.json({error:'Service temporarily unavailable.'},503)}
 }
 await next()
 let errorData:any
 let savedReplyId:string|undefined
 try{
 const nativeProject=context().projectId
 if(nativeProject&&c.res.ok&&!['GET','HEAD','OPTIONS'].includes(c.req.method)&&/^\/api\/knowledge\/[^/]+\/articles(?:\/|$)/.test(c.req.path)){
  // Publication has committed. Its dirty marker stays until the index batch
  // succeeds, and protected writes still fence themselves on that marker.
  try{await updateKnowledgeIndex(rawEnv,nativeProject,100)}
  catch(error){console.error('Article saved; knowledge index refresh failed',error instanceof Error?error.name:'unknown')}
 }
 if(c.req.path==='/api/local-agents/claim'||c.req.path==='/api/local-agents/heartbeat'||c.req.path.startsWith('/api/local-agents/jobs/')||c.req.path.startsWith('/api/delegation/v1/')||c.req.method==='GET'&&/^\/api\/portal\/[^/]+\/tickets(?:\/|$)/.test(c.req.path))return
 if(!c.res.headers.get('Content-Type')?.includes('application/json'))return
 const {projectId}=context(),actor=c.get('actor'),authority=(c as any).get('authority')
 if(!projectId)return
 const member=actor&&actor.role!=='contact'&&!authority,privateComposer=member&&(/\/macros(?:\/|$)|\/macro-draft$/.test(c.req.path)),insertion=member&&/\/knowledge\/.*\/(?:insert|references\/preview)$/.test(c.req.path)
 if(insertion)return
 const conversation=context().conversationId
 const publicKnowledge=c.req.path.startsWith('/api/knowledge/public/'),sourceRead=c.req.path.startsWith('/api/knowledge/')||c.req.path.startsWith('/api/v1/articles')
 const baseReaders=publicKnowledge?accessReaders(await resolveHelpAccess(rawEnv,projectId,c.req.raw)):authority&&c.req.path.startsWith('/api/v1/articles')&&c.req.query('contact_id')?readerSet([{kind:'contact',id:c.req.query('contact_id')!}]):member?memberReaders(actor.id):actor?.role==='contact'?readerSet([{kind:'contact',id:actor.contactId||actor.id}]):conversation?currentTicketReaders(projectId,conversation,{}):anonymousReaders
 const readOnly=c.req.method==='GET'||c.req.method==='HEAD'
 const committed=c.get('knowledgeCommitted')
 const original=c.res
 const body=await original.text()
 let data:any=JSON.parse(body)
 if(c.res.status>=400)errorData=data
 if((readOnly||committed)&&original.ok&&!needsProjection(data)){
  c.res=new Response(body,original)
  return
 }
 if(c.res.status===201&&c.req.method==='POST'&&/^\/api\/(?:management|dashboard)\/projects\/[^/]+\/macros$/.test(c.req.path))savedReplyId=data.data.id
 // A read renders the references already stored in its text and writes nothing: copied runs were turned into
 // references when the text was written (write boundary, upgrade), so a GET creates no block and refreshes no index.
 // A newly saved reply also returns stored text from its guarded write batch.
 if(!readOnly&&!sourceRead&&!savedReplyId&&!committed&&!(member&&data.reason==='knowledge_access_denied'))data=await canonicaliseResponse(rawEnv,projectId,data,conversation,privateComposer)
 const referenceScope=await createReferenceReadScope(rawEnv,projectId,referenceIds(JSON.stringify(data)))
 async function render(value:any,inherited:Readers,cid?:string):Promise<any>{
  if(Array.isArray(value))return Promise.all(value.map(row=>render(row,inherited,cid)))
  if(!value||typeof value!=='object')return typeof value==='string'&&needsKnowledgeRendering(value)?renderKnowledgeFields(rawEnv,projectId!,value,inherited,'body',referenceScope):value
  const ownConversation=responseConversation(value,cid,privateComposer)
  const readers=authority&&ownConversation?currentTicketReaders(projectId!,ownConversation,{}):inherited
  if(typeof value.knowledge_provenance==='string'||typeof value.knowledge_citation==='string')return renderKnowledgeFields(rawEnv,projectId!,value,readers,'body',referenceScope)
  const output:any={}
  for(const [key,entry] of Object.entries(value)){
   const field=needsKnowledgeRendering(key)?await renderKnowledgeFields(rawEnv,projectId!,key,readers,'body',referenceScope):key
   const preserved=member&&value.reason==='knowledge_access_denied'&&['content','blockedReferences'].includes(key)
    ||privateComposer&&['content','actions_json','actions'].includes(key)
   output[field]=preserved||entry===null||typeof entry!=='object'&&(typeof entry!=='string'||!needsKnowledgeRendering(entry))
    ?entry:await render(entry,readers,ownConversation)
  }
  if(member){
   const text=typeof value.content==='string'?value.content:typeof value.text==='string'?value.text:''
   if(referenceIds(text).length){const refs=await referenceVisibility(rawEnv,projectId!,text,actor.id,ownConversation?currentTicketReaders(projectId!,ownConversation,{}):readers,referenceScope);if(privateComposer)output.references=refs;else output.knowledgeReferences=refs}
  }
  return output
 }
 const output=await render(data,baseReaders,conversation),headers=new Headers(c.res.headers);headers.delete('Content-Length');c.res=new Response(JSON.stringify(output),{status:c.res.status,headers})
 }catch(error){
  if(savedReplyId){
   // The saved reply committed. Confirm its identity without exposing unrendered fields.
   console.error('Saved reply created; reference projection failed',error instanceof Error?error.name:'unknown')
   const headers=new Headers(c.res.headers);headers.delete('Content-Length')
   c.res=new Response(JSON.stringify({data:{id:savedReplyId},refresh_required:true}),{status:201,headers})
   return
  }
  if(c.res.status<400)throw error
  // A durable command may already have returned an honest failure outcome.
  // Projection must neither replace its status nor disclose unrendered prose
  // when the same interrupted storage invocation cannot authorize a read.
  const committed=errorData?.code==='ticket_committed'&&errorData.committed===true
  const body=committed?{error:'Ticket changes were saved, but refresh or notification failed. Reload before making further changes.',code:'ticket_committed',committed:true,id:errorData.id,ticket_version:errorData.ticket_version}:{error:'Service temporarily unavailable.'}
  const headers=new Headers(c.res.headers);headers.delete('Content-Length');headers.set('Content-Type','application/json');c.res=new Response(JSON.stringify(body),{status:c.res.status,headers})
 }
}
