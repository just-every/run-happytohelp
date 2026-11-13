import common from '../../journeys/kit/app-worker'
export {ConversationSocket} from '../../journeys/kit/app-worker'
import type {Env} from '../../../src/platform/env'
import {readManifest,readRows,originalIdentity} from '../../../src/modules/legacy-import/worker/reader'
import {WorkerImportError} from '../../../src/modules/legacy-import/worker/errors'
import {knowledgeWriteEnvironment,planLegacyKnowledgeTargets} from '../../../src/modules/knowledge/write-boundary'
import {updateKnowledgeIndex,planCanonicaliseFields} from '../../../src/modules/knowledge/canonicaliser'
import {importLegacy,planImport} from '../../../src/modules/legacy-import/importer'
import {takeDeltaLease} from '../../../src/modules/legacy-import/lease'
import {unchangedSinceImport,type ImportState} from '../../../src/modules/legacy-import/state'
import {planDelta} from '../../../src/modules/legacy-import/delta-plan'
import {importDelta} from '../../../src/modules/legacy-import/delta'
import {stable,type LegacyBundle,type Row} from '../../../src/modules/legacy-import/types'

/** Test-only probes over actual Worker bindings. Nothing here is mounted by the application. */
export default {
 ...common,
 async fetch(request:Request,env:Env,ctx:ExecutionContext){
  const url=new URL(request.url)
  if(url.pathname==='/_test/legacy/reader'){
   try{
    const sha=url.searchParams.get('sha')!,project=url.searchParams.get('project')!,manifest=await readManifest(env.FILES,sha,project)
    const part=manifest.chunks[0],rows=part?await readRows(env.FILES,sha,project,'chunk',part):[]
    const identity=part?await originalIdentity(manifest,sha,part,rows):null
    return Response.json({rows:rows.length,identity:identity?.id??null,sourceProjectId:manifest.source.projectId})
   }catch(error){if(error instanceof WorkerImportError)return Response.json({code:error.code},{status:error.status});throw error}
  }
  if(url.pathname==='/_test/legacy/custody'){
   const {projectId,foreignProjectId}=await request.json<{projectId:string;foreignProjectId:string}>()
   const text=Array.from({length:120},()=> 'A synthetic archive preserves the original customer account history across every import and verifies each relationship before any write.').join(' ')
   const db=env.DB,wrapped=knowledgeWriteEnvironment(env,()=>({projectId})),article='synthetic-legacy-custody-article'
   // Quoted source INSERT is the core insertJson path; source text must stay exact even if it matches another source.
   await db.prepare("INSERT INTO knowledge_articles(id,project_id,slug,title,content,summary,status,updated_at) VALUES(?,?,?,'Source',?,'','published',1)").bind(article,foreignProjectId,article,text).run()
   await updateKnowledgeIndex(env,foreignProjectId)
   await wrapped.DB.prepare('INSERT INTO "knowledge_articles"(id,project_id,slug,title,content,summary,status,updated_at) VALUES(?,?,?,\'Copy\',?,\'\',\'draft\',1)').bind(article+'-copy',projectId,article+'-copy',text).run()
   const sourceKept=(await db.prepare('SELECT content FROM knowledge_articles WHERE id=?').bind(article+'-copy').first<{content:string}>())?.content===text
   const contact='synthetic-legacy-custody-contact',conversation='synthetic-legacy-custody-conversation',message='synthetic-legacy-custody-message'
   await db.prepare("INSERT INTO contacts(id,project_id,name,created_at) VALUES(?,?,'Synthetic',1)").bind(contact,projectId).run()
   await db.prepare('INSERT INTO conversations(id,project_id,contact_id,created_at,updated_at) VALUES(?,?,?,1,1)').bind(conversation,projectId,contact).run()
   await wrapped.DB.prepare("INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at) VALUES(?,?,?,'synthetic-native-local',?,'operator',?,2,1)").bind(message+'-native',projectId,conversation,'synthetic-operator',text).run()
   const native=await db.prepare('SELECT content FROM messages WHERE id=?').bind(message+'-native').first<{content:string}>()
   const row:Row={id:message,project_id:projectId,conversation_id:conversation,contact_id:contact,content:text,created_at:1,local_id:'synthetic-original-local'}
   const bundle:LegacyBundle={format:'happytohelp-legacy-v1',source:{repository:'synthetic',revision:'synthetic',exportedAt:'2026-01-01T00:00:00.000Z',projectId},tables:{messages:[row]}}
   const context:LegacyBundle={...bundle,tables:{...bundle.tables,contacts:[{id:contact,project_id:projectId}],conversations:[{id:conversation,project_id:projectId,contact_id:contact}]}}
   await db.prepare("UPDATE knowledge_articles SET title='Source revised',updated_at=2 WHERE id=?").bind(article).run()
   const beforePlan=await db.prepare('SELECT count(*) n FROM knowledge_reply_blocks').first<{n:number}>(),dirtyBefore=await db.prepare('SELECT count(*) n FROM knowledge_index_dirty').first<{n:number}>()
   const readOnly=await planCanonicaliseFields(env,foreignProjectId,{content:text})
   const planReadOnly=(await db.prepare('SELECT count(*) n FROM knowledge_reply_blocks').first<{n:number}>())?.n===beforePlan?.n&&(await db.prepare('SELECT count(*) n FROM knowledge_index_dirty').first<{n:number}>())?.n===dirtyBefore?.n
   const fullPlan=await planImport(bundle,{context}),prepared={identity:{id:fullPlan.id,bundleDigest:fullPlan.bundleDigest,source:fullPlan.source},finalize:false as const,normalize:(targets:any)=>planLegacyKnowledgeTargets(wrapped,projectId,targets)}
   const lease=await takeDeltaLease(()=>wrapped.DB,projectId)
   try{
    const first=await importLegacy(wrapped,bundle,{context,lease,prepared})
    const journal=await db.prepare('SELECT source_json FROM legacy_import_rows WHERE run_id=? AND source_id=?').bind(first.id,message).first<{source_json:string}>()
    const canonical=await db.prepare('SELECT * FROM messages WHERE id=?').bind(message).first<Row>()
    const state=await db.prepare("SELECT * FROM legacy_import_state WHERE target_table='messages' AND target_key=?").bind(message).first<ImportState>()
    const stateMatches=await unchangedSinceImport(canonical!,state??undefined)
    const replay=await importLegacy(wrapped,bundle,{context,lease,prepared})
    const edited={...row,content:text+' Legacy added a later sentence.'},deltaContext={...context,tables:{...context.tables,messages:[edited]}}
    const plan=await planDelta(wrapped.DB,{projectId,context:deltaContext,conversations:[conversation],messages:[edited],media:[],ours:new Set()})
    const delta=await importDelta(wrapped,{...bundle,source:{...bundle.source,delta:true},tables:{messages:[edited]}},{context:deltaContext,lease,projectId,plan,checkOnly:true,prepared:{...prepared,identity:await (async()=>{const p=await planImport({...bundle,source:{...bundle.source,delta:true},tables:{messages:[edited]}},{context:deltaContext});return {id:p.id,bundleDigest:p.bundleDigest,source:p.source}})()}})
    return Response.json({sourceKept,journalExact:journal?.source_json===stable(row),nativeProtected:typeof native?.content==='string'&&native.content!==text,planReadOnly,planWrites:readOnly.statements.length,importLiteral:canonical?.content===text,stateMatches,replayApplied:replay.applied,deltaConflicts:delta.conflicts.length,conversation,message,sourceBytes:new TextEncoder().encode(text).length})
   }finally{await lease.release()}
  }
  if(url.pathname==='/_test/legacy/chunk-identity'){
   const {sha,projectId}=await request.json<{sha:string;projectId:string}>(),manifest=await readManifest(env.FILES,sha,projectId),part=manifest.chunks[0],rows=await readRows(env.FILES,sha,projectId,'chunk',part)
   const identity=await originalIdentity(manifest,sha,part,rows)
   const {chunkBundle}=await import('../../../src/modules/legacy-import/worker/reader')
   const plan=await planImport(chunkBundle(manifest,sha,part,rows))
   return Response.json({same:identity.id===plan.id,rows:plan.rows.length})
  }
  return common.fetch(request,env,ctx)
 },
}
