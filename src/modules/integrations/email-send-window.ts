import {AsyncLocalStorage} from 'node:async_hooks'

/** Notification execution ends after 60 seconds, including preparation and all
 * provider I/O. Cron waits twice that long before retiring an abandoned claim.
 * A suspended continuation cannot start provider I/O after its deadline. */
export const notificationSendMs=60000
export const abandonedNotificationMs=120000
export const abandonedNotificationReason='the worker stopped during a send; check the provider before resending'
const window=new AsyncLocalStorage<{deadline:number;controller:AbortController}>()
export function notificationSendSignal(signal?:AbortSignal|null){
 const current=window.getStore()
 if(!current)return signal??undefined
 if(Date.now()>=current.deadline)current.controller.abort(new Error('Notification send execution expired'))
 current.controller.signal.throwIfAborted()
 return signal?AbortSignal.any([signal,current.controller.signal]):current.controller.signal
}
/** The real network edge, with the notification execution's cancellation added
 * to each transport's existing, shorter request timeout. */
export const notificationFetch:typeof fetch=(input,init)=>fetch(input,{...init,signal:notificationSendSignal(init?.signal)})
export async function withNotificationSendWindow<T>(ids:readonly string[],started:number,run:()=>Promise<T>):Promise<T>{
 if(!ids.some(id=>/^message:[^:]+:notification(?::|$)/.test(id)))return run()
 const controller=new AbortController(),deadline=started+notificationSendMs
 return window.run({deadline,controller},async()=>{
  let timer:ReturnType<typeof setTimeout>|undefined
  const ended=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{
   const error=new Error('Notification send execution expired');controller.abort(error);reject(error)
  },Math.max(0,deadline-Date.now()))})
  try{notificationSendSignal();return await Promise.race([run(),ended])}
  finally{clearTimeout(timer);controller.abort(new Error('Notification send execution ended'))}
 })
}
