import {httpsTransport} from '../../api-integrations/transport'
import {createSlackBotProtocol,renderSlackEvent,serializeSlackMessage} from '../../../vendor/base/modules/integrations/slack/index.ts'
import type {Outcome} from '../../../vendor/base/modules/integrations/core/types.ts'

/** Slack lookup that never changes anything and is safe to repeat. Only the fixed
 * method names are called, over the installation's own bot token. */
export async function slackLookup(token:string,method:'auth.test'|'users.info'|'conversations.open',params:Record<string,string>={}){
 const response=await httpsTransport.send({url:`https://slack.com/api/${method}`,headers:{'content-type':'application/x-www-form-urlencoded','authorization':`Bearer ${token}`},body:new URLSearchParams(params).toString()})
 let body:any;try{body=JSON.parse(response.body)}catch{throw new Error('slack_response_unreadable')}
 if(response.status!==200||!body||body.ok!==true)throw new Error('slack_lookup_refused')
 return body
}
export interface Prepared {wire:Parameters<typeof httpsTransport.send>[0];classify:(response:Awaited<ReturnType<typeof httpsTransport.send>>,now:number)=>Outcome}
/** Prepare (but do not send) one fixed message to the member's own Slack DM. The
 * vendor protocol validates the token, DM channel and message shape. */
export async function prepareDirectMessage(input:{id:string;projectId:string;destinationId:string;token:string;channel:string;summary:string;sections:string[]},now:number):Promise<Prepared>{
 const protocol=createSlackBotProtocol({resolveDestination:async()=>({token:input.token,channel:input.channel})})
 const message=renderSlackEvent('teammate',{},{teammate:()=>({summary:input.summary,sections:input.sections})})
 const wire=await protocol.prepare({id:input.id,tenant:input.projectId,destinationId:input.destinationId,event:'teammate',protocol:protocol.id,body:serializeSlackMessage(message,input.channel)},now)
 return {wire,classify:(response,at)=>protocol.classify(response,at)}
}
export const sendPrepared=(prepared:Prepared)=>httpsTransport.send(prepared.wire)
