import type {Env} from '../../platform/env'
import type {EmailInput} from '../integrations/email'
import {envelopeReaders} from './readers'
import {canonicaliseFields} from './canonicaliser'
import {referenceAdmissionPolicy} from './reference-policy'
import {referenceIds,renderKnowledgeFields,renderKnowledge} from './reference-store'
import {literal} from './door'
export async function mailConversation(env:Env,input:EmailInput){
 const message=/^message:([^:]+):/.exec(input.idempotencyKey)
 if(message&&input.projectId)return (await env.DB.prepare('SELECT conversation_id FROM messages WHERE id=? AND project_id=?').bind(message[1],input.projectId).first<{conversation_id:string}>())?.conversation_id
 // Explicit transcript/partner/problem mail includes its conversation identity.
 const match=/(?:transcript|conversation|problem)[^:]*:([^:]+)/.exec(input.idempotencyKey)
 if(match&&input.projectId)return (await env.DB.prepare('SELECT id FROM conversations WHERE id=? AND project_id=?').bind(match[1],input.projectId).first<{id:string}>())?.id
 return undefined
}
export async function canonicaliseMail(env:Env,input:EmailInput):Promise<EmailInput>{
 if(!input.projectId){if(referenceIds(JSON.stringify(input)).length)throw new Error('Knowledge mail needs a workspace');return input}
 const protectedFields=await canonicaliseFields(env,input.projectId,{subject:input.subject,text:input.text,html:input.html})
 return {...input,...protectedFields}
}
export async function mailClaimSql(env:Env,input:EmailInput){
 const content=JSON.stringify({subject:input.subject,text:input.text,html:input.html})
 const ids=referenceIds(content)
 if(!input.projectId)return {prefix:'',sql:ids.length?'0=1':'1=1',params:[] as unknown[]}
 if(!ids.length)return referenceAdmissionPolicy(ids,literal(input.projectId),{sql:"SELECT 'anonymous' kind,NULL id"})
 const readers=envelopeReaders(input.projectId,await mailConversation(env,input),[input.to,...(input.cc||[]),...(input.bcc||[])])
 return referenceAdmissionPolicy(ids,literal(input.projectId),readers)
}
export async function renderMail(env:Env,input:EmailInput):Promise<EmailInput>{
 if(!input.projectId||!referenceIds(JSON.stringify({subject:input.subject,text:input.text,html:input.html})).length)return input
 const readers=envelopeReaders(input.projectId,await mailConversation(env,input),[input.to,...(input.cc||[]),...(input.bcc||[])])
 return {...input,...await renderKnowledgeFields(env,input.projectId,{subject:input.subject,text:input.text},readers),html:input.html===undefined?undefined:await renderKnowledge(env,input.projectId,input.html,readers,'html')}
}
