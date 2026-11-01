import type {Env} from '../../platform/env'
import {canonicaliseFields,ticketCustody} from './canonicaliser'

/** Use the same ticket identity for copy custody and current-reader rendering. */
export function responseConversation(value:any,inherited?:string,privateComposer=false):string|undefined{
 return typeof value.conversation_id==='string'?value.conversation_id:typeof value.conversationId==='string'?value.conversationId:typeof value.contact_id==='string'&&typeof value.id==='string'&&'revision' in value?value.id:privateComposer&&typeof value.id==='string'&&('draft' in value||'changes' in value)?value.id:inherited
}

/** List/search envelopes have no route ticket. Group their text by each row's
 * ticket before canonicalising, so identical quotes in two tickets never share
 * personal copy blocks. Nested matched messages inherit or name their own ticket.
 * Keep one corpus lookup per ticket, rather than one for every response field. */
export async function canonicaliseResponse(env:Env,projectId:string,value:unknown,conversationId?:string,privateComposer=false){
 const groups=new Map<string|undefined,{text:string[];protected?:string[]}>()
 const collect=(item:unknown,cid?:string):(()=>unknown)=>{
  if(typeof item==='string'){
   let group=groups.get(cid)
   if(!group){group={text:[]};groups.set(cid,group)}
   const index=group.text.length;group.text.push(item)
   return ()=>group!.protected![index]
  }
  if(Array.isArray(item)){const children=item.map(child=>collect(child,cid));return ()=>children.map(rebuild=>rebuild())}
  if(item&&typeof item==='object'){
   const own=responseConversation(item,cid,privateComposer)
   const entries=Object.entries(item).map(([key,child])=>[collect(key,own),collect(child,own)] as const)
   return ()=>Object.fromEntries(entries.map(([key,rebuild])=>[String(key()),rebuild()]))
  }
  return ()=>item
 }
 const rebuild=collect(value,conversationId)
 for(const [cid,group] of groups){
  // A response identifier never grants custody across workspaces.
  const custody=cid?async(project:string)=>(await env.DB.prepare('SELECT 1 FROM conversations WHERE id=? AND project_id=?').bind(cid,project).first())?ticketCustody(cid):undefined:undefined
  group.protected=await canonicaliseFields(env,projectId,group.text,undefined,false,custody)
 }
 return rebuild()
}
