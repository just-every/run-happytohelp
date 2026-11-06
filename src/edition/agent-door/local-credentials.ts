import type {Env} from '../../platform/env'
import {hashToken} from '../../platform/auth'
import {activeGrantSql,type Grant} from '../delegation/common'
import type {Principal} from '../../vendor/agent-base/modules/agent-door/index.ts'
import {linkedProject} from './people.ts'
import {ToolRefusal} from '../../vendor/agent-base/modules/agent-door/index.ts'
import {memberAccess} from '../../modules/access/gate'
export const grantScopes=(scopes:string[])=>scopes.flatMap(scope=>({
 'support.conversation.read':['happytohelp.conversations.read','happytohelp.context.read'],
 'knowledge.article.read':['happytohelp.articles.read'],
 'knowledge.article.update':['happytohelp.articles.update'],
 'knowledge.article.publish':['happytohelp.articles.publish'],
}[scope]??[]))
export async function currentGrant(env:Env,id:string){
 if(typeof env.RER_INSTALLATION_ID!=='string')return null
 return env.DB.prepare(activeGrantSql+' AND g.id=?').bind(Date.now(),env.RER_INSTALLATION_ID,id).first<Grant>()
}
export async function localCredential(env:Env,request:Request){
 const authorization=request.headers.get('authorization')
 if(!authorization?.startsWith('Bearer ')||request.headers.has('cookie')||typeof env.RER_INSTALLATION_ID!=='string')return null
 const grant=await env.DB.prepare(activeGrantSql+' AND g.token_hash=?').bind(Date.now(),env.RER_INSTALLATION_ID,await hashToken(authorization.slice(7))).first<Grant>(),link=await linkedProject(env)
 if(!grant||grant.project_id!==link?.project_id)return null
 return {sponsor:{id:grant.principal_id},agent:{id:'edition:'+grant.client_id,name:'Connected application '+grant.client_id},scopes:grantScopes(JSON.parse(grant.scopes)),clientId:'edition:'+grant.id}
}
export async function selectedTarget(env:Env,who:Pick<Principal,'person'|'clientId'>,kind:'articles'|'conversations',id:string){
 const link=await linkedProject(env)
 if(!link)throw new ToolRefusal('not_found')
 if(!who.clientId?.startsWith('edition:'))return
 const grant=await currentGrant(env,who.clientId.slice(8))
 if(!grant||grant.principal_id!==who.person.id||grant.project_id!==link.project_id||!JSON.parse(grant.targets).includes(`projects/${link.project_id}/${kind}/${id}`))throw new ToolRefusal('not_found')
}
export async function currentGrantScopes(env:Env,principal:Principal){
 if(!principal.clientId)return principal.scopes
 if(!principal.clientId.startsWith('edition:'))return principal.scopes
 const grant=await currentGrant(env,principal.clientId.slice(8))
 if(!grant||grant.principal_id!==principal.person.id)return []
 const access=await memberAccess(env.DB,grant.project_id,principal.person.id)
 return grantScopes(JSON.parse(grant.scopes)).filter(scope=>!scope.includes('.articles.')||(scope.endsWith('.read')?(access?.permissions.has('knowledge.read')||access?.permissions.has('knowledge.edit')):access?.permissions.has(scope.endsWith('.publish')?'knowledge.publish':'knowledge.edit')))
}
