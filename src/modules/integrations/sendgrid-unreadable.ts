import PostalMime from 'postal-mime'
import type {Env} from '../../platform/env'
import {holdRawEmail} from './unreadable-email'
import {hashToken} from '../../platform/auth'
import {HTTPException} from 'hono/http-exception'

/** In ordinary Parse mode SendGrid supplies MIME headers and decoded fields,
 * not original SMTP MIME. Retain exactly those headers plus the full POST; never
 * manufacture an original message from decoded text or attachments. */
export async function parseSendgridHeaders(env:Env,headers:string,fields:Record<string,unknown>,payload:()=>Promise<ArrayBuffer|Uint8Array>){
 try{return await PostalMime.parse(headers)}catch{
  let envelope:any={};try{envelope=JSON.parse(typeof fields.envelope==='string'?fields.envelope:'{}')}catch{}
  const recipients=Array.isArray(envelope.to)?envelope.to.filter((value:unknown):value is string=>typeof value==='string'):[]
  const fingerprint=[]
  for(const [key,value] of Object.entries(fields).sort(([a],[b])=>a.localeCompare(b))){
   fingerprint.push([key,value instanceof File?{name:value.name,type:value.type,hash:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await value.arrayBuffer()))).join(',')}:value])
  }
  const rawMime=typeof fields.email==='string'&&fields.email?fields.email:null
  const source=await payload()
  const context={identity:await hashToken(JSON.stringify(fingerprint)),
   description:rawMime?'This email could not be read. The raw MIME supplied by SendGrid is retained as original.eml.':
    'This email could not be read. SendGrid supplied decoded fields rather than original MIME. The unreadable MIME headers are retained as original.eml; the complete provider submission is retained as sendgrid-payload.bin.',
   attachments:[{filename:'sendgrid-payload.bin',contentType:'application/octet-stream',content:Uint8Array.from(source instanceof Uint8Array?source:new Uint8Array(source)).buffer}]}
  let held=false
  for(const recipient of recipients){
   try{await holdRawEmail(env,new TextEncoder().encode(rawMime||headers),{...context,recipients:[recipient]});held=true}catch(error){
    if(!(error instanceof HTTPException&&error.status===404))throw error
   }
  }
  if(!held)throw new HTTPException(404,{message:'Inbound mailbox is not configured'})
  return null
 }
}
