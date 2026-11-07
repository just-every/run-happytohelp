import type {Env} from '../../src/platform/env'

/** Count binding invocations, rather than SQL statements. A native D1 batch is
 * one round trip even when the application wraps it with extra assertions. */
export function measuredBindings(env:Env){
 const metrics={d1RoundTrips:0,r2:{get:0,head:0,put:0,delete:0,list:0},queueSends:0}
 const originals=new WeakMap<object,D1PreparedStatement>()
 const statement=(value:D1PreparedStatement):D1PreparedStatement=>{
  const proxy=new Proxy(value,{get(target,key){
   if(key==='bind')return (...args:any[])=>statement(target.bind(...args))
   const member=Reflect.get(target,key)
   if(['first','all','run','raw'].includes(String(key)))return (...args:any[])=>{metrics.d1RoundTrips++;return member.apply(target,args)}
   return typeof member==='function'?member.bind(target):member
  }})
  originals.set(proxy,value);return proxy
 }
 const DB=new Proxy(env.DB,{get(target,key){
  if(key==='prepare')return (sql:string)=>statement(target.prepare(sql))
  if(key==='batch')return (values:D1PreparedStatement[])=>{metrics.d1RoundTrips++;return target.batch(values.map(value=>originals.get(value)??value))}
  const member=Reflect.get(target,key)
  if(key==='exec')return (...args:any[])=>{metrics.d1RoundTrips++;return member.apply(target,args)}
  return typeof member==='function'?member.bind(target):member
 }})
 const FILES=new Proxy(env.FILES,{get(target,key){const member=Reflect.get(target,key);if(key in metrics.r2)return (...args:any[])=>{metrics.r2[key as keyof typeof metrics.r2]++;return member.apply(target,args)};return typeof member==='function'?member.bind(target):member}})
 return {metrics,env:{...env,DB,FILES} as Env}
}
