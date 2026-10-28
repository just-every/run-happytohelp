import assert from 'node:assert/strict'
import {openaiStream} from '../openai-stream.mjs'
import {startApp,sha} from '../../journeys/kit/app.mjs'

// A workspace mailbox on the real application. Mail arrives through the Worker's email entry, the
// JSON gateway or SendGrid Inbound Parse; outbound mail is captured at the mail provider, which
// `mail.mode` can make fail. Mailboxes answer their MX lookup so they can receive replies.
export async function mailApp({bindings={},projectId='p',inbound='inbound@example.com',outbox='support@example.com',tls}={}){
 // Each provider answers as it does on acceptance; `mail.respond(entry)` may answer instead (a refusal,
 // a bounce, or a response held open), and `mail.mode='lost'` loses the response after the request.
 const accepted=entry=>entry.host==='api.sendgrid.com'?new Response(null,{status:202,headers:{'X-Message-Id':`sg-${mail.sent.length}`}}):entry.host==='api.cloudflare.com'?Response.json({success:true,result:{queued:[].concat(entry.body.to).map(to=>to?.email??to),delivered:[],permanent_bounces:[]}}):Response.json({id:`resend-${mail.sent.length}`})
 const mail={sent:[],mode:'deliver',attempts:0,respond:null,model:null,dnsRecords:null,dnsOffline:false}
 const app=await startApp({captureQueue:true,...(tls?{socketModule:tls.socketModule}:{}),origin:'https://app.example',bindings:{APP_ORIGIN:'https://app.example',EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'fixture-resend',EMAIL_FROM:outbox,INBOUND_EMAIL_TOKEN:'fixture-gateway',...tls?.bindings,...bindings},outbound:async request=>{
  const url=new URL(request.url)
  if(url.hostname==='synthetic-mail-edge.example'){assert.ok(tls);return tls.outbound(request)}
  if(url.hostname==='api.openai.com'){assert.ok(mail.model,'model execution must be explicitly selected by the fixture');return openaiStream(await mail.model(await request.json()))}
  if(url.hostname==='cloudflare-dns.com'){
   if(mail.dnsOffline)return new Response('DNS unavailable',{status:503})
   const name=url.searchParams.get('name'),txt=url.searchParams.get('type')==='TXT'
   return Response.json({Status:0,Answer:txt?(mail.dnsRecords?.[name]||[]).map(data=>({type:16,data:JSON.stringify(data)})):name==='unrouted.example'?[]:[{type:15,data:'10 mx.example.com.'}]})
  }
  assert.ok(['api.resend.com','api.sendgrid.com','api.cloudflare.com'].includes(url.hostname),'unexpected mail destination')
  mail.attempts++;if(mail.mode==='lost')throw new Error('response lost')
  const entry={url:request.url,host:new URL(request.url).hostname,headers:Object.fromEntries(request.headers),body:await request.json()};mail.sent.push(entry)
  return (await mail.respond?.(entry))??accepted(entry)
 }})
 await app.db.batch([
  app.db.prepare("INSERT INTO projects(id,name,widget_key,allowed_origin,created_at) VALUES(?,'Project','w','https://example.com',1)").bind(projectId),
  app.db.prepare("INSERT INTO email_settings VALUES(?,'Support',?,?,1,1)").bind(projectId,outbox,inbound),
  app.db.prepare("INSERT INTO users VALUES('op','op@example.com','Operator',1)"),app.db.prepare("INSERT INTO memberships VALUES(?,'op','operator')").bind(projectId),
  app.db.prepare("INSERT INTO sessions(token_hash,actor_id,project_id,role,contact_id,expires_at) VALUES(?,'op',?,'operator',NULL,?)").bind(sha('operator-token'),projectId,Date.now()+3600000),
 ])
 await app.presenceAwayOff(projectId)
 const operator={Authorization:'Bearer operator-token'}
 // The reply address a transcript mail carries for that recipient, as the customer would see it.
 const replyAddress=async(conversationId,recipient)=>{
  const before=mail.sent.length,response=await app.request(`/api/dashboard/projects/${projectId}/conversations/${conversationId}`,{method:'PUT',headers:operator,body:{send_transcript_to:recipient,idempotencyKey:crypto.randomUUID()}})
  assert.equal(response.status,200,await response.text());const sent=await app.until(()=>mail.sent.slice(before).find(entry=>recipients(entry.body).includes(recipient)),{message:'transcript mail'})
  mail.sent.splice(mail.sent.indexOf(sent),1);return replyTo(sent.body)
 }
 // Worker delivery; resolves to the rejection reason, if any.
 const email=async(raw,{from,to,direct})=>{const result=await app.email(raw,{from:from||'<>',to,direct}),text=result.text||JSON.stringify(result);if(direct&&result.status===200)return result.rejected;if(/reject/i.test(text))return text;if(result.status!==200)throw new Error(text);return undefined}
 const gateway=body=>app.request('/api/integrations/email/inbound',{method:'POST',headers:{Authorization:'Bearer fixture-gateway'},body})
 const claim=id=>app.db.prepare('SELECT * FROM inbound_emails WHERE id IN (?,?)').bind(id,`<${id}>`).first()
 const admitted=async id=>app.db.prepare('SELECT * FROM messages WHERE id=?').bind((await claim(id)).message_id).first()
 // The schedule's outbox replay after a lost acknowledgement, and a minute of inactivity for digests.
 const replay=async message=>{await app.db.prepare('UPDATE conversation_outbox SET delivered_at=NULL WHERE message_id=?').bind(message.id).run();await app.scheduled()}
 const idle=async()=>{await app.scheduled();await app.scheduled(undefined,{after:61000})}
 const count=async sql=>(await app.db.prepare(sql).first()).n
 const post=(path,body,headers=operator)=>app.request(`/api/conversations/${path}`,{method:'POST',headers,body})
 return {app,get DB(){return app.db},mail,operator,replyAddress,email,gateway,claim,admitted,replay,idle,count,post,close:()=>app.close()}
}

export const message=({id,to,from='Customer <customer@example.com>',subject='Question about my order',headers='',text='Hello',type='text/plain',authenticated=true})=>{
 // The network fixture supplies the receiving provider's own top verdict. Cases
 // about absent/forged authentication opt out or carry their explicit verdict.
 const domain=from.match(/@([a-z0-9.-]+)/i)?.[1]
 const auth=authenticated&&domain&&!/Authentication-Results:/i.test(headers)?`Authentication-Results: mx.cloudflare.net; dkim=pass header.d=${domain}; dmarc=pass header.from=${domain}\r\n`:''
 return `From: ${from}\r\nTo: ${to}\r\nSubject: ${subject}\r\nMessage-ID: <${id}>\r\n${auth}${headers}MIME-Version: 1.0\r\nContent-Type: ${type}\r\n\r\n${text}`
}

// Recipients and reply address of a captured provider request, whichever transport's shape it has.
export const recipients=body=>[].concat(body.personalizations?.[0]?.to??body.to??[]).map(to=>to?.email??to)
export const replyTo=body=>body.reply_to?.email??body.reply_to
