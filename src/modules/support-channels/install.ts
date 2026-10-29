import {HTTPException} from 'hono/http-exception'
import {providerJson,boundedFetch} from './network'
import type {Provider} from './model'
export async function qualify(provider:Provider,account:string,sender:string,token:string,channels:string[],input:any){
 if(provider==='slack'){
  const headers={Authorization:'Bearer '+token,'Content-Type':'application/x-www-form-urlencoded'}
  const response=await boundedFetch('https://slack.com/api/auth.test',{method:'POST',headers,body:''}),data=JSON.parse(new TextDecoder().decode(response.data)),scopes=(response.headers.get('x-oauth-scopes')||'').split(',').map(s=>s.trim())
  if(response.status!==200||!data.ok||data.team_id!==account||data.user_id!==sender||!['chat:write','channels:history','files:read','im:history'].every(s=>scopes.includes(s)))throw new HTTPException(409,{message:'Slack app identity or scopes do not match. Install chat:write, channels:history, files:read and im:history.'})
  for(const channel of channels){const info=await providerJson('https://slack.com/api/conversations.info?channel='+encodeURIComponent(channel),{headers});if(!info.ok||info.channel?.id!==channel||!info.channel?.is_member||!info.channel?.is_ext_shared||info.channel?.is_archived)throw new HTTPException(409,{message:'The app must belong to each active Slack Connect customer channel'})}
  return {scopes,channels}
 }
 if(provider==='sms'){
  const service=typeof input.messaging_service==='string'?input.messaging_service.trim():'';if(!service)throw new HTTPException(400,{message:'A registered Twilio Messaging Service ID is required'})
  const headers={Authorization:'Basic '+btoa(account+':'+token)},base='https://messaging.twilio.com/v1/Services/'+encodeURIComponent(service)
  const phone=await providerJson(base+'/PhoneNumbers?PageSize=100',{headers}),campaigns=await providerJson(base+'/Compliance/Usa2p?PageSize=50',{headers})
  if(!phone.phone_numbers?.some((p:any)=>p.phone_number===sender&&p.account_sid===account)||!campaigns.usa2p?.some((c:any)=>c.account_sid===account&&c.campaign_status==='VERIFIED'))throw new HTTPException(409,{message:'Twilio has not confirmed this US sender and a VERIFIED A2P campaign on the Messaging Service'})
  return {messaging_service:service,a2p:'VERIFIED'}
 }
 return {installation:'provider-scoped webhook; live installation qualification pending'}
}
