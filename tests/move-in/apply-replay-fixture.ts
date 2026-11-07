import {prepareMapping} from '../../src/modules/move-in/readers/normalise'
import {sourceRecord} from '../../src/modules/move-in/readers/common'
import {retainReview} from '../../src/modules/move-in/plans'
import {getRun} from '../../src/modules/move-in/run-store'
import {sha256} from '../../src/modules/import-kit/src/d1/index'
import {pullBatches,pullFingerprint,summarize} from '../../src/modules/move-in/zendesk-source/approval'
import type {Env} from '../../src/platform/env'

/** Test-edge preparation only. Native mapping, bounded reviewed plans and exact
 * R2 originals are real; approval and every apply step use the public doors. */
export async function seedApplyReplay(request:Request,env:Env){
 const {index,runs=61,entries=14770,tickets=6214}=await request.json<any>()
 if(!Number.isSafeInteger(index)||index<0||index>=runs)throw new Error('invalid_fixture_index')
 const share=(total:number)=>Math.floor(total/runs)+(index<total%runs?1:0)
 const ticketCount=share(tickets),contactCount=share(entries-tickets),offset=index*10000
 if(contactCount<ticketCount)throw new Error('fixture_requires_local_requesters')
 const stamp='2024-01-01T00:00:00Z',users=Array.from({length:contactCount},(_,i)=>({user:{id:offset+i+1,role:'end-user',name:`synthetic-hh-${offset+i+1}`,email:`synthetic-hh-${offset+i+1}@example.test`,created_at:stamp}}))
 const history=Array.from({length:ticketCount},(_,i)=>{const id=offset+i+1;return {ticket:{id,requester_id:id,subject:`synthetic-hh ticket ${id}`,description:`synthetic-hh history ${id}`,status:['open','pending','solved','closed'][i%4],created_at:stamp,updated_at:stamp,via:{channel:i%2?'email':'web'},comments:Array.from({length:3},(_,n)=>({id:id*10+n,author_id:id,body:`synthetic-hh message ${id}/${n}`,public:n!==2,created_at:stamp}))}}})
 const rows=[...users,...history],body=rows.map(row=>JSON.stringify(row)).join('\n')+'\n',bytes=new TextEncoder().encode(body),hash=sha256(bytes),id=`synthetic-hh-replay-${index}`,key=`move-in/p/${id}/original`
 const session=await env.DB.prepare("SELECT token_hash FROM sessions WHERE actor_id='owner' AND project_id='p'").first<{token_hash:string}>()
 if(!session)throw new Error('fixture_owner_missing')
 const pullId='synthetic-hh-apply-replay'
 if(index===0)await env.DB.prepare("INSERT INTO move_in_zendesk_pulls(id,project_id,actor_id,session_hash,subdomain,state,phase,counts_json,created_at,updated_at) VALUES(?,'p','owner',?,'synthetic-hh','ready','review',?,1,1)").bind(pullId,session.token_hash,JSON.stringify({source:{tickets,users:entries-tickets,organizations:0,ticketFields:0,articles:0,deleted:0,replies:0}})).run()
 await env.DB.prepare("INSERT INTO move_in_runs(id,project_id,actor_id,session_hash,vendor,filename,artifact_hash,object_key,bytes,state,identity_complete,identity_audited,source,parsed_total,created_at,updated_at) VALUES(?,'p','owner',?,'zendesk','synthetic-hh.jsonl',?,?,?,'planning',1,1,'zendesk-pull',?,1,1)").bind(id,session.token_hash,hash,key,bytes.length,rows.length).run()
 await env.FILES.put(key,bytes)
 const source={records:rows.map((row,i)=>{const kind='user' in row?'user':'ticket',payload=(row as any)[kind];return sourceRecord('zendesk',kind,String(payload.id),payload,'synthetic-hh.jsonl',hash,i+1,`/${kind}`)}),artifacts:[{name:'synthetic-hh.jsonl',sha256:hash,size:bytes.length,original:{status:'unavailable' as const,reason:'not-supplied' as const}}],diagnostics:[]}
 const prepared=await prepareMapping({projectId:'p',actorId:'owner',vendor:'zendesk',source,tagIds:new Map()})
 if(prepared.rejections.size)throw new Error(JSON.stringify([...prepared.rejections]))
 const run=(await getRun(env,id))!;await retainReview(env,run,source,prepared,0)
 const ready=(await getRun(env,id))!
 const {summary}=await summarize(env,ready)
 await env.DB.prepare('INSERT INTO move_in_zendesk_pull_runs(pull_id,ordinal,run_id,summary_json) VALUES(?,?,?,?)').bind(pullId,index,id,JSON.stringify(summary)).run()
 const fingerprint=index===runs-1?pullFingerprint(await pullBatches(env,pullId)):undefined
 return Response.json({id,entries:rows.length,tickets:ticketCount,contacts:contactCount,pullId,fingerprint})
}

/** Test-edge comparison of the adapter's two read paths over the applied data:
 * every selected key returns what a single read returns, in key order, with
 * duplicates, absent keys and an erased contact included. A malformed row only
 * fails the call that selects it. */
export async function compareSelectedReads(env:Env){
 const {nativeTargets}=await import('../../src/modules/move-in/targets'),read=nativeTargets.readMany!
 const owned=async(kind:string)=>(await env.DB.prepare("SELECT target_id id FROM move_in_origins WHERE project_id='p' AND target_kind=? ORDER BY target_id").bind(kind).all<{id:string}>()).results.map(row=>({kind,id:row.id}))
 const keys=[...await owned('contact'),...await owned('conversation')]
 await env.DB.prepare("INSERT INTO contacts(id,project_id,name,email,external_id,created_at,is_verified,metadata_json) VALUES('synthetic-erased','p',NULL,NULL,NULL,1,0,'{\"is_erased\":1}')").run()
 // The store refuses malformed contact metadata outright; a malformed origin record, where it can be written, must fail only the read that selects it.
 const malformed=await env.DB.prepare("INSERT INTO move_in_origins(project_id,target_kind,target_id,vendor,source_id,source_json,revision) VALUES('p','contact','synthetic-malformed','zendesk','synthetic-malformed','not json','synthetic')").run().then(()=>true,()=>false)
 const selected=[...keys,{kind:'contact',id:'synthetic-erased'},{kind:'contact',id:'synthetic-absent'},{kind:'conversation',id:'synthetic-absent'},keys[0],keys.at(-1)!,{kind:'contact',id:'synthetic-erased'}]
 const many=await read(env.DB,'p',selected),singles:unknown[]=[]
 for(const key of selected)singles.push(await nativeTargets.read(env.DB,'p',key.kind,key.id))
 const mismatched=selected.filter((_,i)=>JSON.stringify(many[i])!==JSON.stringify(singles[i])).length
 const rejected=async(run:()=>Promise<unknown>)=>run().then(()=>false,()=>true)
 const failures={
  malformedSingle:!malformed||await rejected(()=>nativeTargets.read(env.DB,'p','contact','synthetic-malformed')),
  malformedSelected:!malformed||await rejected(()=>read(env.DB,'p',[keys[0],{kind:'contact',id:'synthetic-malformed'}])),
  malformedUnselected:!await rejected(()=>read(env.DB,'p',[keys[0]])),
  unknownKind:await rejected(()=>read(env.DB,'p',[{kind:'synthetic-unknown',id:'x'}]))
 }
 return Response.json({compared:selected.length,present:many.filter(Boolean).length,mismatched,failures})
}
