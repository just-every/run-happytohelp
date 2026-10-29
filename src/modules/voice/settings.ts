import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {hashToken} from '../../platform/auth'
import {encryptToken} from '../integrations/secrets'
import {requireStepUp} from '../identity/two-factor/step-up'
import {named,object,invalid} from '../tickets/model'
import {auditStatement,requestSource} from '../audit/record'
import {voiceAccess,settingsInput,providerId,limitations,type VoiceNumber} from './model'
import {providerRequest} from './provider'
export const base='/projects/:projectId'
export const settingsRoutes=new Hono<AppEnv>()
settingsRoutes.get(base+'/numbers',async c=>{
 const {actor}=await voiceAccess(c);const rows=(await c.env.DB.prepare('SELECT id,provider,provider_id,account_id,phone,settings_json,version,enabled,token_cipher IS NOT NULL connected FROM voice_numbers WHERE project_id=? ORDER BY phone').bind(actor.projectId).all<any>()).results
 return c.json({data:rows.map(({settings_json,...n})=>({...n,settings:JSON.parse(settings_json),webhook_url:new URL('/api/voice/hooks/'+n.id,c.req.url).href})),limitations,launch:'Unqualified: provider sandbox, emergency number/location and jurisdiction review remain required. AI voice agent is unavailable.'})
})
settingsRoutes.post(base+'/numbers',async c=>{
 const {actor,guard}=await voiceAccess(c);await requireStepUp(c,actor,'voice.install')
 const b=object(await c.req.json());if(!['twilio','aircall'].includes(b.provider))invalid('Choose Twilio Voice or Aircall')
 const settings=settingsInput(b.settings),provider_id=providerId(b.provider_id),account_id=providerId(b.account_id),token=named(b.token,10000),id='number-'+await hashToken(JSON.stringify([actor.projectId,b.provider,provider_id]))
 if(settings.group_id&&!await c.env.DB.prepare('SELECT id FROM ticket_groups WHERE project_id=? AND id=?').bind(actor.projectId,settings.group_id).first())invalid('Choose a workspace queue')
 const cipher=await encryptToken(c.env,actor.projectId,token),secret=crypto.randomUUID()+crypto.randomUUID(),webhookHash=await hashToken(secret),now=Date.now()
 const n={id,project_id:actor.projectId,provider:b.provider,provider_id,account_id,token_cipher:cipher} as VoiceNumber
 const verification=await providerRequest(c.env,n,b.provider==='twilio'?`/IncomingPhoneNumbers/${provider_id}.json`:`/numbers/${provider_id}`)
 const data=b.provider==='twilio'?verification.data:verification.data?.number
 if(!verification.ok||!data||String(b.provider==='twilio'?data.sid:data.id)!==provider_id||b.provider==='twilio'&&data.account_sid!==account_id)throw new HTTPException(409,{message:'The provider did not verify ownership of this support number'})
 const phone=String(b.provider==='twilio'?data.phone_number:data.digits);if(!/^\+[1-9]\d{7,14}$/.test(phone))invalid('Provider did not return an international number')
 const existing=await c.env.DB.prepare('SELECT version,phone,account_id FROM voice_numbers WHERE id=? AND project_id=?').bind(id,actor.projectId).first<{version:number;phone:string;account_id:string}>()
 if(existing&&(b.version!==existing.version||existing.phone!==phone||existing.account_id!==account_id))throw new HTTPException(409,{message:'Reload the number before updating it'})
 const result=await c.env.DB.batch([
 c.env.DB.prepare(`INSERT INTO voice_numbers(id,project_id,provider,provider_id,account_id,phone,token_cipher,webhook_hash,settings_json,updated_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(${guard.sql}) AND coalesce((SELECT version FROM voice_numbers WHERE id=?),0)=? ${settings.group_id?'AND EXISTS(SELECT 1 FROM ticket_groups WHERE project_id=? AND id=?)':''} ON CONFLICT(id) DO UPDATE SET token_cipher=excluded.token_cipher,webhook_hash=excluded.webhook_hash,settings_json=excluded.settings_json,enabled=1,version=voice_numbers.version+1,updated_at=excluded.updated_at`).bind(id,actor.projectId,b.provider,provider_id,account_id,phone,cipher,webhookHash,JSON.stringify(settings),now,...guard.params,id,existing?.version??0,...(settings.group_id?[actor.projectId,settings.group_id]:[])),
 auditStatement(c.env.DB,{projectId:actor.projectId,category:'integration',action:'voice.number_connected',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'voice_number',id},detail:{provider:b.provider}},now,{sql:'EXISTS(SELECT 1 FROM voice_numbers WHERE id=? AND project_id=? AND version=? AND updated_at=?)',params:[id,actor.projectId,(existing?.version??0)+1,now]}),
 ])
 if(!result[0].meta.changes)throw new HTTPException(409,{message:'Number or authority changed; reload'})
 return c.json({data:{id,phone,version:(existing?.version??0)+1,webhook_url:new URL('/api/voice/hooks/'+id,c.req.url).href,...(b.provider==='aircall'?{webhook_token:secret}:{})}},201)
})
settingsRoutes.delete(base+'/numbers/:numberId',async c=>{
 const {actor,guard}=await voiceAccess(c);await requireStepUp(c,actor,'voice.disconnect')
 const id=c.req.param('numberId')!,now=Date.now(),r=await c.env.DB.batch([
 c.env.DB.prepare(`UPDATE voice_numbers SET enabled=0,token_cipher=NULL,webhook_hash=NULL,version=version+1,updated_at=? WHERE id=? AND project_id=? AND EXISTS(${guard.sql})`).bind(now,id,actor.projectId,...guard.params),
 auditStatement(c.env.DB,{projectId:actor.projectId,category:'integration',action:'voice.number_disconnected',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'voice_number',id}},now,{sql:'EXISTS(SELECT 1 FROM voice_numbers WHERE id=? AND project_id=? AND enabled=0 AND updated_at=?)',params:[id,actor.projectId,now]}),
 ])
 if(!r[0].meta.changes)throw new HTTPException(409)
 return c.json({data:{disconnected:true}})
})
