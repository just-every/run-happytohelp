import type {Env} from '../../platform/env'
import type {Run} from './types'
import {assertAuthority} from './context'
/** An opaque unique nonce reserves each exact key before content is written. Erasure can
 * delete either the placeholder or content; an in-flight conditional replacement
 * cannot recreate deleted content, even if the writer crashes before its check.
 * Every key is reserved before the one authority check and every body is written
 * after it, so D1 reads stay constant however many objects one invocation retains. */
export async function putPrivateAll(env:Env,run:Run,keys:string[],body:(index:number)=>string|Uint8Array,options:R2PutOptions={}){
 const reservations:R2Object[]=[]
 for(const key of keys){await assertAuthority(env,run);const prior=await env.FILES.head(key),reservation=prior??await env.FILES.put(key,crypto.randomUUID(),{onlyIf:{etagDoesNotMatch:'*'}});if(!reservation)throw new Error('source_custody_race');reservations.push(reservation)}
 try{
  await assertAuthority(env,run)
  for(let i=0;i<keys.length;i++){await assertAuthority(env,run);const written=await env.FILES.put(keys[i],body(i),{...options,onlyIf:{etagMatches:reservations[i].etag}});if(!written)throw new Error('source_custody_erased')}
  await assertAuthority(env,run)
 }catch(error){
  // A conditional-write loser does not own the winner's bytes. Only erasure
  // authorizes deleting whatever currently occupies the group's private keys.
  const erased=await env.DB.prepare("SELECT 1 FROM move_in_runs WHERE id=? AND state='erased'").bind(run.id).first()
  if(erased)for(const key of keys)await env.FILES.delete(key)
  throw error
 }
}
export function putPrivate(env:Env,run:Run,key:string,body:string|Uint8Array,options:R2PutOptions={}){return putPrivateAll(env,run,[key],()=>body,options)}
