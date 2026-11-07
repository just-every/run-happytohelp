import type {Env} from '../../src/platform/env'

/** Count binding invocations, rather than SQL statements. A native D1 batch is
 * one round trip even when the application wraps it with extra assertions. */
export function measuredBindings(env:Env){
 const metrics:{d1RoundTrips:number;entryReads:Record<'source'|'target'|'predecessor',number>;setReads:Record<'source'|'target'|'predecessor',number>;r2:Record<'get'|'head'|'put'|'delete'|'list',number>;queueSends:number;trace?:string[]}={d1RoundTrips:0,entryReads:{source:0,target:0,predecessor:0},setReads:{source:0,target:0,predecessor:0},r2:{get:0,head:0,put:0,delete:0,list:0},queueSends:0}
 // APPLY_TRACE (a test binding) lists each round trip's statement heads, to find what a step still spends.
 if((env as any).APPLY_TRACE)metrics.trace=[]
 const record=(query:string)=>{metrics.d1RoundTrips++;metrics.trace?.push(query.slice(0,120));if(query==='SELECT * FROM ik_sources WHERE identity=?')metrics.entryReads.source++;else if(query==='SELECT * FROM ik_provenance WHERE destination=? AND target_kind=? AND target_id=? AND reversed=0')metrics.entryReads.predecessor++;else if(query.startsWith('SELECT (SELECT COALESCE(json_group_array(json_array('))metrics.entryReads.target++;else if(query.startsWith('SELECT * FROM ik_sources WHERE identity IN ('))metrics.setReads.source++;else if(query.startsWith('SELECT * FROM ik_provenance WHERE destination=? AND (target_kind,target_id) IN ('))metrics.setReads.predecessor++}
 const originals=new WeakMap<object,D1PreparedStatement>(),queries=new WeakMap<object,string>()
 const statement=(value:D1PreparedStatement,query:string):D1PreparedStatement=>{
  const proxy=new Proxy(value,{get(target,key){
   if(key==='bind')return (...args:any[])=>statement(target.bind(...args),query)
   const member=Reflect.get(target,key)
   if(['first','all','run','raw'].includes(String(key)))return (...args:any[])=>{record(query);return member.apply(target,args)}
   return typeof member==='function'?member.bind(target):member
  }})
  originals.set(proxy,value);queries.set(proxy,query);return proxy
 }
 const DB=new Proxy(env.DB,{get(target,key){
  if(key==='prepare')return (sql:string)=>statement(target.prepare(sql),sql)
  if(key==='batch')return (values:D1PreparedStatement[])=>{metrics.d1RoundTrips++;metrics.trace?.push(`batch(${values.length}) ${queries.get(values[0])?.slice(0,100)}`);for(const value of values)if(queries.get(value)?.startsWith('SELECT wanted.value AS id,'))metrics.setReads.target++;return target.batch(values.map(value=>originals.get(value)??value))}
  const member=Reflect.get(target,key)
  if(key==='exec')return (...args:any[])=>{metrics.d1RoundTrips++;return member.apply(target,args)}
  return typeof member==='function'?member.bind(target):member
 }})
 const FILES=new Proxy(env.FILES,{get(target,key){const member=Reflect.get(target,key);if(key in metrics.r2)return (...args:any[])=>{metrics.r2[key as keyof typeof metrics.r2]++;return member.apply(target,args)};return typeof member==='function'?member.bind(target):member}})
 return {metrics,env:{...env,DB,FILES} as Env}
}
