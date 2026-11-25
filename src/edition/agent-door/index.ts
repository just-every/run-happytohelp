import {installationTrust} from './trust'
import {createAgentDoor} from '../../vendor/agent-base/modules/agent-door/index.ts'
import {isAgentPath} from './path'
import type {Env} from '../../platform/env'
import {happyPeople} from './people.ts'
import {happySettings} from './settings.ts'
import {happyTools,notTools} from './tools.ts'
import {happyResources} from './resources.ts'
import {localCredential,currentGrantScopes} from './local-credentials.ts'
export function happyDoor(env:Env,origin:string){
 return createAgentDoor({seed:'happytohelp',name:'HappyToHelp',specialist:'support agent',db:env.DB,origin,trust:installationTrust(env,origin),people:happyPeople(env),tools:happyTools(env),resources:happyResources(env),notTools,
  erasure:{secret:String(env.INTEGRATION_ENCRYPTION_KEY??''),async fenced(_name,args){
   if(typeof args.id!=='string')return false
   return !!await env.DB.prepare("SELECT 1 FROM contacts contact JOIN conversations ticket ON ticket.project_id=contact.project_id AND ticket.contact_id=contact.id JOIN h2h_business_project link ON link.project_id=ticket.project_id WHERE ticket.id=? AND json_extract(contact.metadata_json,'$.is_erasing')=1").bind(args.id).first()
  }},
  localCredentials:request=>localCredential(env,request),currentScopes:principal=>currentGrantScopes(env,principal),
  prompts:[{name:'support-shift',title:'Support shift',description:'Read the selected ticket and current context, preserve private notes, prepare internal work and inspect native outcomes. Connector execution, sending and publication retain their native authority.',clauses:['CONVERSATION-001','CONTEXT-001','DELEGATION-001'],messages:()=>[{role:'user',content:{type:'text',text:'Find the customer ticket, read its transcript and context, then assign and add an internal note under current company policy. Read the ticket again to confirm the native effect. Never infer recovery or customer delivery from a connector claim.'}}]}],
 })
}
export async function handleAgentRequest(request:Request,env:Env){
 const path=new URL(request.url).pathname
 if(!isAgentPath(path))return null
 const origin=typeof env.APP_ORIGIN==='string'?new URL(env.APP_ORIGIN).origin:new URL(request.url).origin
 try{if(path==='/api/rer/business-settings')return await happySettings(env).handle(request)
 return await happyDoor(env,origin).handle(request)}catch{return Response.json({code:'agent_door_unavailable'},{status:503,headers:{'cache-control':'no-store'}})}
}
