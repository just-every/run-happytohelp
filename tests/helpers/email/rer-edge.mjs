import {createHash,createHmac} from 'node:crypto'
export const inboundPath='/api/integrations/email/rer/v1/inbound'
export const canonical=value=>JSON.stringify(value&&typeof value==='object'?Array.isArray(value)?value.map(item=>JSON.parse(canonical(item))):Object.fromEntries(Object.keys(value).sort().map(key=>[key,JSON.parse(canonical(value[key]))])):value)
export function managedEdge(){
 const installations=new Map(),sends=[],controls=[],ledger=new Map()
 const add=name=>{
  const bindings={INTEGRATION_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64'),RER_INSTALLATION_ID:'synthetic-'+name,MAIL_PROVIDER:'rer',MAIL_FROM:`hth-synthetic-${name}@mail.example.test`,MAIL_RELAY_URL:'https://mail-service.example.test/api/managed-mail/happytohelp/v1/send',H2H_RER_MAIL_VERSION:'1',RER_MAILBOX_ID:'synthetic-mailbox-'+name,RER_MAIL_ADDRESS:`hth-synthetic-${name}@mail.example.test`,RER_MAIL_CONTROL_URL:'https://mail-service.example.test/api/managed-mail/happytohelp/v1/mailboxes',MAIL_API_KEY:'synthetic-relay-authority-'+name,RER_MAIL_INGRESS_KEY:'synthetic-ingress-authority-'+name,INBOUND_EMAIL_TOKEN:'synthetic-reply-authority-'+name,H2H_SETUP_TOKEN:'synthetic-setup-'+name}
  const mailbox={mailboxId:bindings.RER_MAILBOX_ID,address:bindings.RER_MAIL_ADDRESS,workspaceId:null,state:'reserved',generation:1,configured:true,routeActive:true,observed:false,lastInboundAt:null}
  installations.set(bindings.MAIL_API_KEY,{bindings,allocations:new Map([['default',mailbox]])});return bindings
 }
 const edge={sends,controls,ledger,loseResponse:false,conflict:false,routeActive:true,statusFailures:0,add,installations,
  async outbound(request,{url,body}){
   const target=new URL(url)
   if(target.hostname!=='mail-service.example.test')return new Response('Unreachable test network',{status:503})
   const authority=request.headers.get('authorization')?.replace(/^Bearer /,''),installation=installations.get(authority)
   if(!installation)return Response.json({code:'mail_credential_revoked'},{status:401})
   const payload=body?JSON.parse(body):null,all=[...installation.allocations.values()]
   if(target.pathname.includes('/mailboxes')){
    controls.push({authority,payload,method:request.method})
    if(edge.conflict)return Response.json({code:'mailbox_binding_conflict'},{status:409})
    if(request.method==='GET'){if(edge.statusFailures>0){edge.statusFailures--;return new Response('Temporary status outage',{status:503})}const mailbox=all.find(row=>row.mailboxId===target.pathname.split('/').pop());return mailbox?Response.json({...mailbox,routeActive:edge.routeActive}):new Response(null,{status:404})}
    if(payload.action==='reserve'){
     let mailbox=installation.allocations.get(payload.allocationKey)
     if(!mailbox){const suffix=installation.allocations.size,base=installation.bindings;mailbox={mailboxId:base.RER_MAILBOX_ID+'-'+suffix,address:base.RER_MAIL_ADDRESS.replace('@','-'+suffix+'@'),workspaceId:null,state:'reserved',generation:1,configured:true,routeActive:true,observed:false,lastInboundAt:null};installation.allocations.set(payload.allocationKey,mailbox)}
     return Response.json(mailbox)
    }
    const mailbox=all.find(row=>row.mailboxId===payload.mailboxId)
    if(!mailbox)return Response.json({code:'mailbox_unavailable'},{status:404})
    if(payload.action==='retire'){mailbox.state='revoked';mailbox.routeActive=false;mailbox.generation++;return Response.json(mailbox)}
    if(mailbox.workspaceId&&mailbox.workspaceId!==payload.workspaceId)return Response.json({code:'mailbox_binding_conflict'},{status:409})
    mailbox.workspaceId=payload.workspaceId;mailbox.state='active';mailbox.routeActive=edge.routeActive;return Response.json(mailbox)
   }
   if(request.method==='GET'){const row=ledger.get(authority+':'+target.pathname.split('/').pop());return row?Response.json(row,{status:202}):new Response(null,{status:404})}
   sends.push({authority,payload,headers:Object.fromEntries(request.headers)})
   const mailbox=all.find(row=>row.mailboxId===payload.mailboxId)
   if(!mailbox||mailbox.state!=='active')return Response.json({code:'mailbox_unavailable'},{status:403})
   const key=authority+':'+payload.messageKey,prior=ledger.get(key)
   if(prior&&prior.digest!==canonical(payload))return new Response(null,{status:409})
   const receipt=prior??{accepted:true,state:'accepted',messageId:`<synthetic-${ledger.size}@mail.example.test>`,failure:null,digest:canonical(payload)}
   ledger.set(key,receipt)
   if(edge.loseResponse)throw new Error('Synthetic response lost after provider acceptance')
   return Response.json(receipt,{status:202})
  },
 }
 return edge
}
export function ingressOptions(bindings,raw,metadata,overrides={}){
 const bytes=Buffer.from(raw),m={version:1,deliveryId:'synthetic-delivery-1',mailboxId:bindings.RER_MAILBOX_ID,generation:1,envelopeFrom:'customer@example.test',envelopeTo:bindings.RER_MAIL_ADDRESS,verdict:'verified',timestamp:Date.now(),bodySha256:createHash('sha256').update(bytes).digest('hex'),...metadata}
 const signature=createHmac('sha256',overrides.key||bindings.RER_MAIL_INGRESS_KEY).update('POST\n'+inboundPath+'\n'+canonical(m)+'\n').update(bytes).digest('base64url')
 return {method:'POST',raw:true,body:overrides.body??bytes,headers:{'Content-Type':'message/rfc822','X-RER-Mail-Metadata':Buffer.from(canonical(m)).toString('base64url'),'X-RER-Mail-Signature':signature,...overrides.headers}}
}
export const mime=({id='synthetic-message-1',to='untrusted-header@example.test',text='Can you help with my order?',from='customer@example.test',headers='' }={})=>`From: Northstar Customer <${from}>\r\nTo: ${to}\r\nMessage-ID: <${id}@example.test>\r\nSubject: Order question\r\n${headers}Content-Type: text/plain; charset=utf-8\r\n\r\n${text}`
