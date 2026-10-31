import {resolveHelpAccess} from './access'
import {accessReaders} from './door'
import type {Context} from 'hono'
import type {AppEnv,Env} from '../../platform/env'
import {readerSet,memberReaders,anonymousReaders,type Readers} from './door'
import {currentTicketReaders} from './readers'
import {canonicaliseFields,updateKnowledgeIndex} from './canonicaliser'
import {renderKnowledgeFields,referenceIds,referenceVisibility} from './reference-store'
import {knowledgeWriteEnvironment} from './write-boundary'
import {dispatchKnowledgeUpgrades} from './upgrade-progress'
import {requireActor} from '../../platform/auth'
const schemas=new WeakMap<object,Promise<boolean>>()
export const knowledgeSchemaReady=(env:Env)=>{let ready=schemas.get(env.DB);if(!ready){ready=env.DB.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='knowledge_reply_blocks'").first().then(Boolean);schemas.set(env.DB,ready)}return ready}
/** HTTP's shared door covers all text-bearing fields, including JSON columns and
 * nested list/preview responses. Controller authorization still owns ticket access. */
export async function knowledgeHttpDoor(c:Context<AppEnv>,next:()=>Promise<void>){
 // Uploaded message files are the author's material. Their native ticket and
 // private-note access rules also apply while stored text is being upgraded.
 if(/^\/api\/(?:conversations\/[^/]+\/media(?:\/[^/]+)?|portal\/[^/]+\/tickets\/[^/]+\/attachments(?:\/[^/]+)?|(?:management|dashboard)\/projects\/[^/]+\/media)$/.test(c.req.path)){await next();return}
 const rawEnv=c.env
 if(!await knowledgeSchemaReady(rawEnv)){await next();return}
 const context=()=>{const actor=c.get('actor'),authority=(c as any).get('authority');return {projectId:c.req.param('projectId')||c.req.param('project')||authority?.projectId||actor?.projectId,authorContactId:actor?.role==='contact'?actor.contactId||actor.id:undefined}}
 c.env=knowledgeWriteEnvironment(c.env,context)
 const requestedProject=context().projectId
 const pending=await rawEnv.DB.prepare('SELECT project_id FROM knowledge_upgrade_reports WHERE completed_at IS NULL AND (?1 IS NULL OR project_id=?1) ORDER BY project_id LIMIT 1').bind(requestedProject||null).first<{project_id:string}>()
 if(pending){
  let member=false
  const credential=c.req.header('Authorization')?.replace(/^Bearer /,'')||c.req.header('Cookie')?.match(/(?:^|;\s*)h2h_session=([^;]+)/)?.[1]
  if(credential&&!/^int_[a-f0-9]{64}$/.test(credential))try{const actor=await requireActor(c);member=actor.role!=='contact'&&Boolean(await rawEnv.DB.prepare('SELECT 1 FROM memberships WHERE user_id=? AND project_id=?').bind(actor.id,requestedProject||actor.projectId).first())}catch{}
  // Only the maintenance response wakes recovery here. Member commands leave
  // upgrade dispatch to the scheduler, so a refusal performs no unrelated writes.
  if(!member){await dispatchKnowledgeUpgrades(rawEnv);c.header('Retry-After','1');c.header('Cache-Control','no-store');return c.json({error:'Service temporarily unavailable.'},503)}
 }
 await next()
 const nativeProject=context().projectId
 if(nativeProject&&c.res.status<400&&!['GET','HEAD','OPTIONS'].includes(c.req.method)&&/^\/api\/knowledge\/[^/]+\/articles(?:\/|$)/.test(c.req.path))await updateKnowledgeIndex(rawEnv,nativeProject,100)
 if(c.req.path==='/api/local-agents/claim'||c.req.path==='/api/local-agents/heartbeat'||c.req.path.startsWith('/api/local-agents/jobs/')||c.req.path.startsWith('/api/delegation/v1/')||c.req.method==='GET'&&/^\/api\/portal\/[^/]+\/tickets(?:\/|$)/.test(c.req.path))return
 if(!c.res.headers.get('Content-Type')?.includes('application/json'))return
 const {projectId}=context(),actor=c.get('actor'),authority=(c as any).get('authority')
 if(!projectId)return
 const member=actor&&actor.role!=='contact'&&!authority,privateComposer=member&&(/\/macros(?:\/|$)|\/macro-draft$/.test(c.req.path)),insertion=member&&/\/knowledge\/.*\/(?:insert|references\/preview)$/.test(c.req.path)
 if(insertion)return
 const conversation=c.req.param('conversationId')||(/\/conversations\//.test(c.req.path)?c.req.param('id'):undefined)
 const publicKnowledge=c.req.path.startsWith('/api/knowledge/public/'),sourceRead=c.req.path.startsWith('/api/knowledge/')||c.req.path.startsWith('/api/v1/articles')
 const baseReaders=publicKnowledge?accessReaders(await resolveHelpAccess(rawEnv,projectId,c.req.raw)):authority&&c.req.path.startsWith('/api/v1/articles')&&c.req.query('contact_id')?readerSet([{kind:'contact',id:c.req.query('contact_id')!}]):member?memberReaders(actor.id):actor?.role==='contact'?readerSet([{kind:'contact',id:actor.contactId||actor.id}]):conversation?currentTicketReaders(projectId,conversation,{}):anonymousReaders
 let data:any=await c.res.json()
 if(!sourceRead&&!(member&&data.reason==='knowledge_access_denied'))data=await canonicaliseFields(rawEnv,projectId,data)
 async function render(value:any,inherited:Readers,cid?:string):Promise<any>{
  if(Array.isArray(value))return Promise.all(value.map(row=>render(row,inherited,cid)))
  if(!value||typeof value!=='object')return renderKnowledgeFields(rawEnv,projectId!,value,inherited)
  const ownConversation=typeof value.conversation_id==='string'?value.conversation_id:typeof value.conversationId==='string'?value.conversationId:typeof value.contact_id==='string'&&typeof value.id==='string'&&'revision' in value?value.id:privateComposer&&typeof value.id==='string'&&('draft' in value||'changes' in value)?value.id:cid
  const readers=authority&&ownConversation?currentTicketReaders(projectId!,ownConversation,{}):inherited
  if(typeof value.knowledge_provenance==='string'||typeof value.knowledge_citation==='string')return renderKnowledgeFields(rawEnv,projectId!,value,readers)
  const output:any={}
  for(const [key,entry] of Object.entries(value))output[await renderKnowledgeFields(rawEnv,projectId!,key,readers)]=member&&value.reason==='knowledge_access_denied'&&['content','blockedReferences'].includes(key)?entry:privateComposer&&['content','actions_json','actions'].includes(key)?entry:await render(entry,readers,ownConversation)
  if(member){
   const text=typeof value.content==='string'?value.content:typeof value.text==='string'?value.text:''
   if(referenceIds(text).length){const refs=await referenceVisibility(rawEnv,projectId!,text,actor.id,ownConversation?currentTicketReaders(projectId!,ownConversation,{}):readers);if(privateComposer)output.references=refs;else output.knowledgeReferences=refs}
  }
  return output
 }
 const output=await render(data,baseReaders,conversation),headers=new Headers(c.res.headers);headers.delete('Content-Length');c.res=new Response(JSON.stringify(output),{status:c.res.status,headers})
}
