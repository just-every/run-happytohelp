/** Test-only mounting of B's generic APIs. Actual application upload/jobs wiring belongs to C. */
import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {Env,AppEnv} from '../../../src/platform/env'
import common from '../../journeys/kit/app-worker'
import {scope} from '../../../src/modules/management/common'
import {memberAccess} from '../../../src/modules/access/gate'
import {requireStepUp} from '../../../src/modules/identity/two-factor/step-up'
import {admitCustody,putCustody,sourceReady,getCustody,renewCustody,discardCustody,cleanupStep,discoverCleanup,CustodyError,descriptorOrdinal,type KeyKind,type CustodyPrincipal} from '../../../src/modules/legacy-import/custody'
export {ConversationSocket} from '../../journeys/kit/app-worker'
let reached:string|null=null,release:(()=>void)|null=null
const wait=async(point:string,selected:string|null)=>{if(point!==selected)return;reached=point;let blocked=true;release=()=>{blocked=false};while(blocked)await new Promise<void>(resolve=>setTimeout(resolve,10));reached=null;release=null}
function intercepted(env:Env,request:Request):Env{
 const barrier=request.headers.get('x-custody-barrier'),fault=request.headers.get('x-custody-fault')
 let puts=0
 return {...env,FILES:new Proxy(env.FILES,{get(target,prop){
  if(prop==='put')return async(key:string,body:any,options:any)=>{const n=++puts;await wait(n===1?'before_reserve':'before_body',barrier);const result=await target.put(key,body,options);await wait(n===1?'after_reserve':'after_body',barrier);return result}
  if(prop==='delete')return async(keys:string|string[])=>{if(fault==='delete')throw new Error('Synthetic storage failure');await wait('before_delete',barrier);await target.delete(keys);await wait('after_delete',barrier)}
  const value=(target as any)[prop];return typeof value==='function'?value.bind(target):value
 }})}
}
const routes=new Hono<AppEnv>()
routes.onError((error,c)=>error instanceof CustodyError?c.json({code:error.code},error.status as any):error instanceof HTTPException?error.getResponse():c.json({code:'storage_unavailable'},503))
routes.use('/_custody/projects/:projectId/*',async(c,next)=>{
 const actor=await scope(c,true),access=await memberAccess(c.env.DB,actor.projectId,actor.id)
 if(!access?.permissions.has('data.import'))throw new HTTPException(403)
 await next()
})
const principal=(c:any):CustodyPrincipal=>({projectId:c.req.param('projectId'),actorId:c.get('actor').id,sessionHash:c.get('sessionHash')})
routes.put('/_custody/projects/:projectId/manifest',async c=>{
 const body=new Uint8Array(await c.req.arrayBuffer()),manifest=JSON.parse(new TextDecoder().decode(body)),sha=c.req.header('x-manifest-sha256')!
 const h=await admitCustody(c.env,{...principal(c),sha,sourceProjectId:manifest.source.projectId,destinationProjectId:manifest.destinationProjectId,mappingPolicyVersion:2})
 return c.json({...h,...await putCustody(c.env,h,principal(c),{kind:'manifest',body,bytes:body.length,sha256:sha,takeover:c.req.header('x-takeover')==='1'})},201)
})
routes.put('/_custody/projects/:projectId/:sha/:kind/:file',async c=>{
 const kind=c.req.param('kind') as Exclude<KeyKind,'manifest'>,ordinal=descriptorOrdinal(kind,c.req.param('file')),body=new Uint8Array(await c.req.arrayBuffer()),h={sha:c.req.param('sha'),generation:Number(c.req.header('x-generation')??1)}
 return c.json(await putCustody(c.env,h,principal(c),{kind,ordinal,body,bytes:body.length,sha256:c.req.header('x-sha256')!,takeover:c.req.header('x-takeover')==='1'}))
})
routes.get('/_custody/projects/:projectId/:sha/ready/:kind/:file',async c=>{
 const kind=c.req.param('kind') as Exclude<KeyKind,'manifest'>
 return c.json({ready:await sourceReady(c.env,{sha:c.req.param('sha'),generation:1},principal(c),kind,descriptorOrdinal(kind,c.req.param('file')),c.req.header('x-sha256')!,Number(c.req.header('x-bytes')))})
})
routes.get('/_custody/projects/:projectId/:sha',async c=>{
 const record=await getCustody(c.env.DB,c.req.param('sha'))
 if(!record||record.custody_project_id!==c.req.param('projectId'))throw new HTTPException(404)
 return c.json({status:record.status,generation:record.generation,expiresAt:record.expires_at,lastActivityAt:record.last_explicit_activity_at})
})
routes.post('/_custody/projects/:projectId/:sha/lifecycle',async c=>{
 const {state}=await c.req.json<any>(),h={sha:c.req.param('sha'),generation:1}
 if(state==='discard'){await requireStepUp(c,c.get('actor'),'contact.erase');await discardCustody(c.env,h,principal(c))}
 else await renewCustody(c.env,h,principal(c),state)
 return c.json({ok:true})
})
routes.post('/_custody/cleanup',async c=>{const {sha,generation}=await c.req.json<any>();return c.json(await cleanupStep(c.env,sha,generation))})
routes.post('/_custody/discover',async c=>{const queue:any[]=[];await discoverCleanup({...c.env,JOBS:{send:async(job:any)=>{queue.push(job)}}} as unknown as Env);return c.json({queue})})
routes.get('/_custody/barrier',c=>c.json({reached}))
routes.post('/_custody/barrier',c=>{release?.();return c.json({ok:true})})
export default {...common,async fetch(request:Request,env:Env,context:ExecutionContext){
 const bindings=intercepted(env,request)
 if(new URL(request.url).pathname.startsWith('/_custody/'))return routes.fetch(request,bindings,context)
 return common.fetch(request,bindings,context)
}}
