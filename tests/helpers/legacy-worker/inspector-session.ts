import {Session} from 'node:inspector'

// Local test instrumentation only. Runtime.evaluate invokes this real V8
// session inside workerd's background-thread-enabled inspector dispatch scope.
// It bypasses workerd's custom Profiler.stop adapter, without replacing any
// application request, storage operation or profiler measurement.
const session=new Session()
session.connect()
Object.defineProperty(globalThis,'__h2hProfilerCommand',{
 value:(method:string,params:Record<string,unknown>)=>new Promise((resolve,reject)=>{
  session.post(method,params,(error:Error|null,result:unknown)=>error?reject(error):resolve(result))
 }),
})
