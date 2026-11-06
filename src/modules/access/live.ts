import type {Context} from 'hono'
import type {AppEnv} from '../../platform/env'

/** Delivery only invalidates open views. Every read and commit still checks the
 * current role in storage, including when this notification cannot be delivered. */
export function publishAccessChange(c:Context<AppEnv>,projectId:string,target:{roleId?:string;userId?:string}){
 c.executionCtx.waitUntil((async()=>{
  try{
   const response=await c.env.CONVERSATIONS.get(c.env.CONVERSATIONS.idFromName(`project:${projectId}`)).fetch('https://conversation.internal/access-change',{method:'POST',body:JSON.stringify(target)})
   if(!response.ok)throw new Error('Access notification refused')
  }catch{console.error('Native access refresh notification failed')}
 })())
}
