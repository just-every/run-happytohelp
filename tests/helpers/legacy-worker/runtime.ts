import common from './worker'
export {ConversationSocket} from './worker'
import {unchangedSinceImport} from '../../../src/modules/legacy-import/state'
import {consumeQueue} from '../../../src/queue'
import type {Env} from '../../../src/platform/env'
let failures:string[]=[]
let barrier:string|null=null,release:(()=>void)|null=null
/** Test-only process-death barriers at real storage boundaries. They never
 * substitute a database, queue handler, object body or successful application result. */
function intercepted(env:Env,point:string|null):Env{
 const safe=(error:any)=>{const message=String(error?.message??error)+' '+String(error?.cause?.message??''),known=message.match(/(?:no such (?:table|column): [a-z_]+|[A-Z][A-Z0-9_]+_ERROR[^\n]{0,120}|(?:UNIQUE|CHECK|FOREIGN KEY|NOT NULL) constraint failed[^\n]{0,100}|Type '[a-z]+' not supported)/);const vocabulary=new Set('near syntax error no such table column function too many terms in compound select incomplete input NOT NULL UNIQUE CHECK FOREIGN KEY constraint failed SQL logic database locked malformed JSON unrecognized token not authorized bind values supplied parameters'.split(' '));failures.push(known?.[0]??String(error?.name??'storage_error')+':'+message.split(/[^a-zA-Z]+/).filter(word=>vocabulary.has(word)).join(' '));throw error}
 const descriptions=new WeakMap<object,string>(),raw=new WeakMap<object,D1PreparedStatement>()
 const wait=async(name:string)=>{if(point!==name)return;barrier=name;let blocked=true;release=()=>{blocked=false};while(blocked)await new Promise<void>(resolve=>setTimeout(resolve,10));barrier=null;release=null}
 const wrap=(statement:D1PreparedStatement,sql:string):D1PreparedStatement=>{const proxy=new Proxy(statement,{get(target,key){if(key==='bind')return (...values:unknown[])=>wrap(target.bind(...values),sql);if(['run','all','first','raw'].includes(String(key)))return async(...args:any[])=>{try{return await (target as any)[key](...args)}catch(error){return safe(error)}};const value=(target as any)[key];return typeof value==='function'?value.bind(target):value}});descriptions.set(proxy,sql);raw.set(proxy,statement);return proxy}
 return {...env,DB:{prepare:(sql:string)=>wrap(env.DB.prepare(sql),sql),async batch(statements:D1PreparedStatement[]){const canonical=statements.some(statement=>/INSERT INTO legacy_import_rows\b/.test(descriptions.get(statement)??''));if(canonical)await wait('before_canonical');const result=await env.DB.batch(statements.map(statement=>raw.get(statement)??statement)).catch(safe);if(canonical)await wait('after_canonical');return result},exec:env.DB.exec.bind(env.DB),dump:env.DB.dump.bind(env.DB)} as unknown as D1Database,
 FILES:new Proxy(env.FILES,{get(target,key){if(key==='put')return async(name:string,...args:any[])=>{const result=await (target.put as any)(name,...args);if(name.startsWith('legacy/projects/'))await wait('after_copy');return result};const value=(target as any)[key];return typeof value==='function'?value.bind(target):value}})}
}
export default {...common,async fetch(request:Request,env:Env,context:ExecutionContext){
 const path=new URL(request.url).pathname
 if(path==='/_test/legacy/state-match'){const {messageId,table='messages'}=await request.json<{messageId:string;table?:string}>();if(!['messages','macros'].includes(table))return new Response(null,{status:400});const canonical=await env.DB.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(messageId).first(),state=await env.DB.prepare('SELECT * FROM legacy_import_state WHERE target_table=? AND target_key=?').bind(table,messageId).first();return Response.json({matches:!!canonical&&await unchangedSinceImport(canonical as any,state as any)})}
 if(path==='/_test/legacy/barrier'){if(request.method==='POST')release?.();return Response.json({barrier})}
 if(path==='/_test/legacy/step'){
  failures=[]
  const jobs=await request.json<any[]>(),queue:unknown[]=[],acked:number[]=[],retried:number[]=[],bindings={...intercepted(env,request.headers.get('x-legacy-barrier')),JOBS:{send:async(job:unknown)=>{queue.push(job)}}} as unknown as Env
  const metrics=await consumeQueue({messages:jobs.map((body,index)=>({id:String(index),body,ack(){acked.push(index)},retry(){retried.push(index)}}))} as any,bindings)
  return Response.json({metrics,queue,acked,retried,failures})
 }
 return common.fetch(request,env,context)
}}
