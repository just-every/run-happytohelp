import {createAgentDoor,type Trust} from '../../vendor/agent-base/modules/agent-door/index.ts'
import type {Env} from '../../platform/env'
import {happyPeople} from './people.ts'
import {happySettings} from './settings.ts'
import {happyTools,notTools} from './tools.ts'
import {happyResources} from './resources.ts'
import {localCredential,currentGrantScopes} from './local-credentials.ts'
export function installationTrust(env:Env,origin:string):Trust|null{
 const values=[env.RER_OWNER_CLAIM_ISSUER,env.RER_OWNER_CLAIM_INSTALLATION_ID,env.RER_OWNER_CLAIM_APP_ORIGIN,env.RER_OWNER_CLAIM_PUBLIC_KEYS]
 if(values.every(value=>value===undefined||value==='')){if(env.RER_BUSINESS_TRUST||env.RER_MANAGEMENT_ORIGIN)throw new Error('Paired installation requires its owner-claim public ring');return null}
 if(env.RER_MANAGEMENT_ORIGIN&&env.RER_MANAGEMENT_ORIGIN!==env.RER_OWNER_CLAIM_ISSUER)throw new Error('Owner-claim issuer differs from installation issuer')
 if(values.some(value=>typeof value!=='string'||!value)||env.RER_OWNER_CLAIM_APP_ORIGIN!==origin||env.RER_INSTALLATION_ID&&env.RER_INSTALLATION_ID!==env.RER_OWNER_CLAIM_INSTALLATION_ID)throw new Error('Incomplete or conflicting owner-claim trust')
 return {issuer:String(env.RER_OWNER_CLAIM_ISSUER),installationId:String(env.RER_OWNER_CLAIM_INSTALLATION_ID),appOrigin:origin,publicKeys:JSON.parse(String(env.RER_OWNER_CLAIM_PUBLIC_KEYS))}
}
export function happyDoor(env:Env,origin:string){
 return createAgentDoor({seed:'happytohelp',name:'HappyToHelp',specialist:'support agent',db:env.DB,origin,trust:installationTrust(env,origin),people:happyPeople(env),tools:happyTools(env),resources:happyResources(env),notTools,localCredentials:request=>localCredential(env,request),currentScopes:principal=>currentGrantScopes(env,principal),
  prompts:[{name:'support-shift',title:'Support shift',description:'Read the selected ticket and current context, preserve private notes, prepare internal work and inspect native outcomes. Connector execution, sending and publication retain their native authority.',clauses:['CONVERSATION-001','CONTEXT-001','DELEGATION-001'],messages:()=>[{role:'user',content:{type:'text',text:'Find the customer ticket, read its transcript and context, then assign and add an internal note under current company policy. Read the ticket again to confirm the native effect. Never infer recovery or customer delivery from a connector claim.'}}]}],
 })
}
export const isAgentPath=(path:string)=>path==='/mcp'||path==='/agents'||path.startsWith('/agents/')||path==='/api/rer/agent-policy'||path==='/api/rer/business-settings'||path.startsWith('/.well-known/oauth-protected-resource')
export async function handleAgentRequest(request:Request,env:Env){
 const path=new URL(request.url).pathname
 if(!isAgentPath(path))return null
 const origin=typeof env.APP_ORIGIN==='string'?new URL(env.APP_ORIGIN).origin:new URL(request.url).origin
 try{if(path==='/api/rer/business-settings')return await happySettings(env).handle(request)
 return await happyDoor(env,origin).handle(request)}catch{return Response.json({code:'agent_door_unavailable'},{status:503,headers:{'cache-control':'no-store'}})}
}
