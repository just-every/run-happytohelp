import type {Env} from '../../platform/env'
import {escapeSlackText,validateSlackMessage} from '../../vendor/base/modules/integrations/slack/message'
import {canonicaliseFields} from './canonicaliser'
import {anonymousReaders} from './door'
import {currentTicketReaders} from './readers'
import {renderKnowledgeFields} from './reference-store'

/** A queued event retains references. Only the external disclosure door expands
 * them, for the ticket's current recipients rather than the enqueue-time set. */
export const protectConnectedFields=<T>(env:Env,projectId:string,value:T)=>canonicaliseFields(env,projectId,value)
export async function renderConnectedFields<T>(env:Env,projectId:string,conversationId:string|undefined,value:T){
 const protectedValue=await canonicaliseFields(env,projectId,value)
 return renderKnowledgeFields(env,projectId,protectedValue,conversationId?currentTicketReaders(projectId,conversationId,{}):anonymousReaders)
}
export async function renderConnectedConversation<T extends {messages:any[]}>(env:Env,projectId:string,conversationId:string,value:T):Promise<T>{
 const readers=currentTicketReaders(projectId,conversationId,{}),{messages,...metadata}=value
 const fields=await renderConnectedFields(env,projectId,conversationId,metadata)
 const rendered=await Promise.all(messages.map(async({knowledge_actor_id,...message})=>{
  const protectedMessage=await canonicaliseFields(env,projectId,message,message.actor_role==='contact'?knowledge_actor_id:undefined)
  return renderKnowledgeFields(env,projectId,protectedMessage,readers)
 }))
 return {...fields,messages:rendered} as T
}

/** Bound the persisted preview without ever cutting an opaque reference in two. */
export async function connectedPreviewText(env:Env,projectId:string,text:string,max:number){
 const protectedText=await canonicaliseFields(env,projectId,text)
 let output='',size=0
 for(const part of protectedText.match(/⟦k:[a-f0-9]{32}⟧|./gsu)||[]){const length=Array.from(part).length;if(size+length>max)break;output+=part;size+=length}
 return output
}

// Base already escaped the persisted Slack template. Undo exactly its three
// escapes before rendering; escape the resulting knowledge bytes exactly once.
const unescapeSlack=(value:string)=>value.replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&')
function slackText(value:string,max:number){
 let output=''
 for(const point of value){const escaped=escapeSlackText(point);if(output.length+escaped.length>max)break;output+=escaped}
 return output
}
export async function renderConnectedBody(env:Env,projectId:string,conversationId:string|undefined,body:string,protocol:string){
 const value=JSON.parse(body)
 if(protocol==='webhook')return JSON.stringify(await renderConnectedFields(env,projectId,conversationId,value))
 if(protocol!=='slack.incoming-webhook.v1'&&protocol!=='slack.bot.v1')throw Error('Unsupported connected protocol')
 const channel=protocol==='slack.bot.v1'?value.channel:undefined
 validateSlackMessage(value,channel)
 const fields={text:unescapeSlack(value.text),sections:value.blocks.map((block:any)=>unescapeSlack(block.text.text))}
 const rendered=await renderConnectedFields(env,projectId,conversationId,fields)
 const output={...value,text:slackText(rendered.text,4000),blocks:value.blocks.map((block:any,index:number)=>({...block,text:{...block.text,text:slackText(rendered.sections[index],3000)}}))}
 validateSlackMessage(output,channel)
 return JSON.stringify(output)
}
