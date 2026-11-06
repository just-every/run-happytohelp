import assert from 'node:assert/strict'
import {generate} from './generator.mjs'
import {zip} from './zip.mjs'
import {history,customer} from './helpscout-fixtures.mjs'
import {contact,agent,ticket} from './freshdesk-fixtures.mjs'
import {mailApp} from '../helpers/email/app.mjs'

// Notification metadata is supplied explicitly, never inferred from message bodies.
// Help Scout has one assignee (user OR team); its extra team case tests that group.
export const vendors=['zendesk','helpscout','freshdesk','intercom']
export const methods=vendor=>vendor==='zendesk'?['headers','encoded','number']:vendor==='intercom'?['headers','address']:['headers','number','address']
export function vendorSource(vendor){
 const records=[],cases=[],base=vendor==='zendesk'||vendor==='intercom'?generate(vendor,1).trim().split('\n').map(JSON.parse):[]
 if(vendor==='zendesk')records.push(...base.filter(row=>row.user))
 if(vendor==='intercom')records.push(base.find(row=>row.type==='contact'))
 if(vendor==='helpscout')records.push(customer())
 if(vendor==='freshdesk')records.push(structuredClone(contact),structuredClone(agent))
 const from=vendor==='zendesk'||vendor==='intercom'?'person1@example.test':'ada@example.test'
 const add=(method,state,extra={})=>{
  const n=cases.length+1,numeric=10000+n,sid=vendor==='intercom'?`cv-${n}`:String(numeric),mailbox=`${vendor}@example.com`
  const item={vendor,sid,method,state,from,mailbox,address:`${vendor}+reply${n}@example.com`,token:`A${String(n).padStart(3,'0')}-B123`,chain:[`<old-${vendor}-${n}@example.test>`,`<parent-${vendor}-${n}@example.test>`,`<notice-${vendor}-${n}@example.test>`],...extra}
  const subject=vendor==='zendesk'?`History [${item.token}]`:'Synthetic history'
  const headers={'Message-ID':item.chain[2],'In-Reply-To':item.chain[1],References:item.chain.slice(0,2).join(' '),...(vendor==='zendesk'?{}:{'Reply-To':item.address})}
  let payload,reply
  if(vendor==='zendesk'){
   payload=structuredClone(base.find(row=>row.ticket).ticket);payload.id=numeric;payload.subject=subject;payload.status=state;payload.assignee_id=900001;payload.group_id=700
   payload.comments.forEach((row,i)=>{row.id=numeric*10+i});reply=payload.comments.at(-1);records.push({ticket:payload})
  }else if(vendor==='intercom'){
   payload=structuredClone(base.find(row=>row.type==='conversation'));payload.id=sid;payload.title=subject;payload.state=state==='solved'?'closed':'open';payload.admin_assignee_id='staff-1';payload.team_assignee_id='team-1';payload.channel.initial='email';payload.source.id=`source-${n}`
   payload.conversation_parts.conversation_parts.forEach((row,i)=>{row.id=`part-${n}-${i}`});reply=payload.conversation_parts.conversation_parts.at(-1);records.push(payload)
  }else if(vendor==='helpscout'){
   const h=history(numeric);payload=h.conversation;payload.subject=subject;payload.status=state==='solved'?'closed':'active';payload.assignee={id:extra.team?700:900001,type:extra.team?'team':'user'};reply=h.page._embedded.threads[0];records.push(payload,h.page)
  }else{
   payload=ticket(numeric,state==='solved'?4:state==='closed'?5:2).ticket;payload.subject=subject;payload.group_id=700
   payload.conversations.forEach(row=>{row.attachments=[]});reply=payload.conversations.find(row=>!row.private&&!row.incoming);records.push({ticket:payload})
  }
  if(extra.negative)headers.References+=` <shared-${vendor}@example.test>`
  reply.headers=headers
  cases.push(item);return item
 }
 for(const state of ['open','solved','closed'])for(const method of methods(vendor))add(method,state)
 add('headers','open',{negative:true});add('headers','open',{negative:true})
 if(vendor==='helpscout')add('number','open',{team:true})
 return {vendor,body:records.map(JSON.stringify).join('\n'),cases}
}
export function evidence(item,variant=2){
 if(item.method==='headers')return {headers:variant===2?{'In-Reply-To':item.chain[variant]}:{References:`<unrelated@example.test> ${item.chain[variant]}`}}
 if(item.method==='address')return {to:[item.mailbox,item.address]}
 return {subject:item.method==='encoded'?`Re: [${item.token}]`:item.vendor==='zendesk'?`Re: [Ticket #${item.sid}]`:`Re: [#${item.sid}]`}
}
export async function replyContext(source){
 const m=await mailApp({bindings:{OPENAI_API_KEY:'synthetic-move-in-model-key'}}),{app}=m
 try{
 const workspace=await app.seedWorkspace(source.vendor),project=workspace.projectId
 let token=workspace.tokens.admin
 const password='synthetic-move-in-admin-password-123'
 await app.ok('/api/identity/password',{token,body:{password}})
 const login=async()=>{token=(await app.ok('/api/identity/login',{body:{email:`admin-${source.vendor}@example.test`,password,projectId:project}})).token}
 await login()
 const root=`/api/move-in/projects/${project}/imports`,management=`/api/management/projects/${project}`,dashboard=`/api/dashboard/projects/${project}`
 const call=(path,body,method)=>app.ok(path,{token,body,method})
 const run=async id=>(await call(`${root}/${id}`)).data
 let repacked=false
 const upload=()=>app.ok(`${root}?vendor=${source.vendor}`,{token,raw:true,body:repacked?zip([{name:'notifications.jsonl',body:source.body}]):source.body,headers:{'X-Import-Filename':repacked?'notifications.zip':'notifications.jsonl','X-Import-Schema':'2.16','Content-Type':'application/octet-stream'}})
 const review=async({reimport=false}={})=>{if(reimport)repacked=true;const result=await upload();await app.drainJobs();const ready=await run(result.data.id);assert.equal(ready.state,'ready',JSON.stringify(ready.error));assert.equal(ready.plan.counts.rejected,0,JSON.stringify(ready.plan.decisions.filter(d=>d.rejection)));return ready}
 const apply=async ready=>{await call(`${root}/${ready.id}/apply`,{fingerprint:ready.plan.fingerprint});await app.drainJobs();const done=await run(ready.id);assert.equal(done.state,'completed',JSON.stringify(done.error));return done}
 const ticket=async id=>(await call(`${dashboard}/conversations/${id}/ticket`)).data
 const transcript=id=>call(`/api/conversations/${id}/messages`)
 const keys=()=>app.sql('SELECT conversation_id,key_kind,key_value,source,source_ref,created_at FROM email_threading_keys WHERE project_id=? AND source=? ORDER BY conversation_id,key_kind,key_value',project,source.vendor)
 const counts=async()=>{
  const value=await app.first('SELECT (SELECT count(*) FROM conversations WHERE project_id=?1) tickets,(SELECT count(*) FROM messages WHERE project_id=?1) messages,(SELECT count(*) FROM conversation_outbox WHERE project_id=?1) widget,(SELECT count(*) FROM ai_generations WHERE project_id=?1) model',project)
  return {...value,sends:m.mail.attempts}
 }
 const quiet=async()=>{await app.drainJobs();assert.equal(m.mail.attempts,0,'no outbound mail or model call');assert.ok(app.requests.every(row=>new URL(row.url).hostname==='cloudflare-dns.com'),'only the DNS network fake may be called')}
 let serial=0
 const receive=async(item,overrides={})=>{
  const messageId=`reply-${source.vendor}-${++serial}@example.test`,body={messageId,to:item.mailbox,from:item.from,text:`Customer reply ${serial}`,...evidence(item),...overrides}
  const before=await counts(),result=await app.ok('/api/integrations/email/inbound',{headers:{Authorization:'Bearer fixture-gateway'},body})
  await quiet();return {result,before,after:await counts(),text:body.text}
 }
 const group=(await call(`${dashboard}/ticket-groups`,{name:'Migration team',members:[workspace.users.operator]})).data
 await call(management+'/email-settings',{from_name:'Support',from_address:'support@example.com',inbound_address:source.cases[0].mailbox,is_enabled:true},'PUT')
 return {m,app,workspace,project,get token(){return token},login,root,management,dashboard,group,call,run,upload,review,apply,ticket,transcript,keys,counts,quiet,receive,close:()=>m.close()}
 }catch(error){await m.close();throw error}
}
export async function importedCases(c,source){
 const rows=await c.app.sql('SELECT m.source_id,c.id FROM move_in_conversations m JOIN conversations c ON c.id=m.conversation_id WHERE m.project_id=?',c.project)
 assert.equal(rows.length,source.cases.length)
 return Promise.all(source.cases.map(async item=>{const id=rows.find(row=>row.source_id===item.sid)?.id;assert.ok(id);const before=await c.ticket(id);return {...item,id,before}}))
}
export function delta(before,after,tickets,messages){
 assert.equal(after.tickets-before.tickets,tickets,'ticket delta');assert.equal(after.messages-before.messages,messages,'message delta')
 assert.equal(after.widget-before.widget,messages,'only admitted replies enter the widget outbox')
 assert.equal(after.model-before.model,0);assert.equal(after.sends-before.sends,0)
}
