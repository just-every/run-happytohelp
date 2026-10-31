import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../platform/env'
import type {Survey} from './survey-store'
export const surveySigningConfigured=(env:Env):env is Env&{INBOUND_EMAIL_TOKEN:string}=>typeof env.INBOUND_EMAIL_TOKEN==='string'&&env.INBOUND_EMAIL_TOKEN.length>=16
async function signingKey(env:Env){
 if(!surveySigningConfigured(env))throw new HTTPException(503,{message:'Survey signing requires INBOUND_EMAIL_TOKEN with at least 16 characters'})
 const secret=env.INBOUND_EMAIL_TOKEN
 return crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify'])
}
export type SurveySurface='email'|'portal'|'unknown'|'sms'|'whatsapp'|'instagram'|'messenger'
const payload=(row:Survey,revision:number,surface:SurveySurface='unknown')=>new TextEncoder().encode(JSON.stringify(['csat-v1',row.id,row.project_id,row.resolution_id,row.contact_id,row.recipient,row.expires_at,revision,...(surface!=='unknown'?[surface]:[])]))
export async function surveyToken(env:Env,row:Survey,surface:SurveySurface='email'){
 const signature=await crypto.subtle.sign('HMAC',await signingKey(env),payload(row,row.token_revision,surface))
 return `${row.id}.${row.token_revision}.${surface==='unknown'?'':surface+'.'}${Array.from(new Uint8Array(signature),byte=>byte.toString(16).padStart(2,'0')).join('')}`
}
export async function verifySurveyToken(env:Env,token:string){
 const parts=/^([a-zA-Z0-9-]{1,80})\.(\d{1,9})\.(?:(email|portal|sms|whatsapp|instagram|messenger)\.)?([a-f0-9]{64})$/.exec(token)
 if(!parts)throw new HTTPException(404,{message:'Survey link is unavailable'})
 const row=await env.DB.prepare('SELECT * FROM csat_surveys WHERE id=?').bind(parts[1]).first<Survey>()
 const revision=Number(parts[2]),surface:SurveySurface=(parts[3]??'unknown') as SurveySurface
 if(!row||!await crypto.subtle.verify('HMAC',await signingKey(env),Uint8Array.from(parts[4].match(/../g)!,byte=>parseInt(byte,16)),payload(row,revision,surface)))throw new HTTPException(404,{message:'Survey link is unavailable'})
 return {row,revision,surface}
}
export async function surveyURL(env:Env,row:Survey,surface:SurveySurface='email'){
 if(typeof env.APP_ORIGIN!=='string')throw new HTTPException(503,{message:'Application origin is not configured'})
 return new URL('/api/outcomes/surveys/'+await surveyToken(env,row,surface),env.APP_ORIGIN).href
}
