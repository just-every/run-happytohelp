import {createHmac,randomBytes} from 'node:crypto'
export const signingKey='synthetic-happytohelp-c2-signing-key'
export const paragraph='The amber lighthouse protocol asks every quartermaster to recalibrate the brass tide gauge before the seventh bell, then record each reading in the violet ledger so that harbour pilots can compare drift across the northern channel during spring storms.'
export const harmless='Thanks for writing in, we are looking at this now and will follow up shortly.'
export const senders={control:'control-a@desk-proof.example','preexisting-overlap':'preexisting-b@desk-proof.example','new-overlap':'overlap-c@desk-proof.example'}
export function mailForm(scenario,body,{recipient='support@desk-proof.example',messageId}={}){
 const sender=senders[scenario],tag={control:'ctl','preexisting-overlap':'pre','new-overlap':'ovl'}[scenario]
 const id=messageId||`<${tag}.${randomBytes(6).toString('hex')}@desk-proof.example>`,timestamp=String(Math.floor(Date.now()/1000)),token=randomBytes(25).toString('hex')
 const headers=[['From',`Synthetic Customer <${sender}>`],['To',recipient],['Message-Id',id],['X-Mailgun-Spf','Pass'],['X-Mailgun-Dkim-Check-Result','Pass'],['DKIM-Signature','v=1; d=desk-proof.example; s=s1']]
 return {id,body:new URLSearchParams({recipient,sender,from:sender,subject:scenario==='control'?'Delayed parcel':'Tide gauge calibration','body-plain':body,'message-headers':JSON.stringify(headers),timestamp,token,signature:createHmac('sha256',signingKey).update(timestamp+token).digest('hex')}).toString()}
}
// Only the external provider is replaced; the real Worker owns all admission and durable outcomes.
export default async function network(request){
 const url=new URL(request.url)
 if(url.host==='cloudflare-dns.com'&&url.pathname==='/dns-query'&&url.searchParams.get('name')==='desk-proof.example'&&url.searchParams.get('type')==='MX')return Response.json({Status:0,Answer:[{type:15,data:'10 mx.desk-proof.example.'}]})
 if(url.host==='api.sendgrid.com'&&url.pathname==='/v3/mail/send'&&request.method==='POST'){
  const body=await request.text()
  if(body.includes('synthetic-c2-refusal'))return Response.json({errors:[{message:'Synthetic provider refusal'}]},{status:400})
  if(body.includes('synthetic-c2-uncertain'))return Response.json({errors:[{message:'Synthetic provider unavailable'}]},{status:503})
  return new Response(null,{status:202,headers:{'x-message-id':'synthetic-happytohelp-c2-delivery'}})
 }
 throw new Error('Unexpected C2 provider request')
}
