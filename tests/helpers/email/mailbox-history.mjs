import {writeFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
import {startApp,sha} from '../../journeys/kit/app.mjs'
import {fakeTlsConnect} from './imap-smtp.mjs'

export async function mailboxHistoryJourney({browserProof}={}){
 const results=[]
 const secret='synthetic-happytohelp-history-secret',requests=[],commands=[],sessions=new Map()
 const mime=(index)=>Buffer.from(`From: ${index?'Support':'Customer'} <synthetic-happytohelp-${index+1}@example.test>\r\nTo: synthetic-happytohelp-3@example.test\r\nDate: Tue, 10 Nov 2026 12:0${index}:00 +0000\r\nMessage-ID: <synthetic-happytohelp-${index+1}@example.test>\r\n${index?'References: <synthetic-happytohelp-1@example.test>\r\nIn-Reply-To: <synthetic-happytohelp-1@example.test>\r\n':''}Subject: Replacement parcel\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="synthetic-happytohelp"\r\n\r\n--synthetic-happytohelp\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${index?'Your replacement ships today.':'Please replace the café parcel.'}\r\n--synthetic-happytohelp\r\nContent-Type: text/plain; name="receipt.txt"\r\nContent-Disposition: attachment; filename="receipt.txt"\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from('synthetic-happytohelp receipt '+index).toString('base64')}\r\n--synthetic-happytohelp--\r\n`)
 const raws=[mime(0),mime(1)]
 const app=await startApp({listen:Boolean(browserProof),captureQueue:true,socketModule:`export const connect=${fakeTlsConnect.toString()}`,bindings:{APP_ORIGIN:'https://app.example',INTEGRATION_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64'),GOOGLE_MAIL_CLIENT_ID:'synthetic-happytohelp-google',GOOGLE_MAIL_CLIENT_SECRET:secret,MICROSOFT_MAIL_CLIENT_ID:'synthetic-happytohelp-ms',MICROSOFT_MAIL_CLIENT_SECRET:secret,MAILBOX_SOCKET_HOSTS:'imap.synthetic.example,smtp.synthetic.example'},outbound:async request=>{
  const url=new URL(request.url);requests.push({method:request.method,path:url.pathname})
  if(url.hostname==='synthetic-mail-edge.example'){
   const body=await request.json();assert.equal(body.address.hostname,'imap.synthetic.example','history never opens SMTP');assert.equal(body.address.port,993)
   if(body.open){sessions.set(body.id,true);return new Response('* OK synthetic IMAP\r\n')}
   const line=Buffer.from(body.data).toString(),match=line.match(/^(A\d+) (.*)\r\n$/);assert.ok(match);const [,tag,command]=match
   // Credentials stay in the fake's private command handling, never in reports.
   if(command.startsWith('LOGIN ')){assert.ok(command.includes(secret));commands.push('LOGIN');return new Response(`${tag} OK login\r\n`)}
   commands.push(command)
   if(command.startsWith('EXAMINE '))return new Response(`* OK [UIDVALIDITY 73] stable\r\n* OK [UIDNEXT 3] next\r\n${tag} OK examined\r\n`)
   if(command==='LIST "" "*"')return new Response(`* LIST () "/" "Archive"\r\n* LIST () "/" "Sent"\r\n${tag} OK list\r\n`)
   if(command==='UID SEARCH UID 1:2')return new Response(`* SEARCH 1 2\r\n${tag} OK searched\r\n`)
   const fetch=command.match(/^UID FETCH ([12]) \(UID BODY\.PEEK\[\]\)$/);assert.ok(fetch,'only read commands allowed: '+command)
   const raw=raws[Number(fetch[1])-1];return new Response(Buffer.concat([Buffer.from(`* 1 FETCH (BODY[] {${raw.length}}\r\n`),raw,Buffer.from(`)\r\n${tag} OK fetched\r\n`)]))
  }
  if(url.pathname.endsWith('/token')){assert.equal(request.method,'POST');const grant=new URLSearchParams(await request.text());assert.equal(/send|write|settings\.basic/i.test(grant.get('scope')||''),false);return Response.json({access_token:secret,refresh_token:secret,expires_in:grant.get('code')==='synthetic-happytohelp-live'?3600:1,...(grant.get('code')==='synthetic-happytohelp-broad'?{scope:url.hostname.includes('google')?'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send':'Mail.Read Mail.Send User.Read'}:{})})}
  assert.equal(request.method,'GET','no provider mailbox write method')
  if(url.pathname.endsWith('/settings/sendAs'))return Response.json({sendAs:[]})
  if(url.pathname.endsWith('/profile'))return Response.json({emailAddress:'synthetic-happytohelp-gmail@example.test'})
  if(url.pathname==='/v1.0/me')return Response.json({mail:'synthetic-happytohelp-microsoft@example.test'})
  if(url.pathname.endsWith('/labels'))return Response.json({labels:[{id:'Archive',name:'Archive'},{id:'Sent',name:'Sent'}]})
  if(url.pathname==='/v1.0/me/mailFolders'&&url.searchParams.has('$skip'))return Response.json({value:[]})
  if(url.pathname==='/v1.0/me/mailFolders')return Response.json({value:[{id:'Archive',displayName:'Archive',childFolderCount:1}], '@odata.nextLink':'https://graph.microsoft.com/v1.0/me/mailFolders?$skip=1'})
  if(url.pathname.endsWith('/childFolders'))return Response.json({value:[{id:'Sent',displayName:'Sent',childFolderCount:0}]})
  if(url.pathname.endsWith('/messages')){
   const microsoft=url.hostname==='graph.microsoft.com'
   if(microsoft&&url.searchParams.has('$skip'))return Response.json({value:[{id:'synthetic-happytohelp-2',conversationId:'synthetic-happytohelp-thread'}]})
   if(microsoft)return Response.json({value:[{id:'synthetic-happytohelp-1',conversationId:'synthetic-happytohelp-thread'}],'@odata.nextLink':`https://graph.microsoft.com${url.pathname}?$skip=1`})
   return Response.json(url.searchParams.has('pageToken')?{messages:[{id:'synthetic-happytohelp-2',threadId:'synthetic-happytohelp-thread'}]}:{messages:[{id:'synthetic-happytohelp-1',threadId:'synthetic-happytohelp-thread'}],nextPageToken:'synthetic-happytohelp-next'})
  }
  const m=url.pathname.match(/\/messages\/synthetic-happytohelp-([12])(?:\/\$value)?$/);assert.ok(m,'unexpected provider read: '+url.pathname)
  return url.hostname==='graph.microsoft.com'?new Response(raws[Number(m[1])-1]):Response.json({raw:raws[Number(m[1])-1].toString('base64url')})
 }})
 try{
  const w=await app.seedWorkspace('synthetic-happytohelp-history'),token=w.tokens.owner,base=`/api/management/projects/${w.projectId}`,boxes=base+'/mailboxes'
  const ok=(path,body,method)=>app.ok(path,{token,body,method})
  const tables=['contacts','context_subjects','conversations','messages','media','workspace_tags','conversation_tags','move_in_conversations','move_in_message_sources','move_in_attachment_bytes','move_in_origins']
  const snapshot=async()=>Object.fromEntries(await Promise.all(tables.map(async table=>[table,(await app.sql(`SELECT * FROM ${table}`)).map(row=>JSON.stringify(row)).sort()])))
  const other=await app.seedWorkspace('synthetic-happytohelp-history-other')
  const restricted=(await ok(base+'/roles',{name:'History without integration access',base:'admin',permissions:[]})).data
  await ok(`${base}/agents/${w.users.admin}`,{role:restricted.id},'PUT')
  for(const provider of ['gmail','microsoft','imap']){
   // Scope and PKCE assertions inspect the real authorization redirect.
   let box
   if(provider==='imap')box=(await ok(boxes+'/imap',{mode:'history',address:'synthetic-happytohelp-imap@example.test',imapHost:'imap.synthetic.example',username:'synthetic-happytohelp-1',password:secret,smtpHost:'smtp.synthetic.example',smtpPassword:'must-not-store'})).data
   else{
    const auth=new URL((await ok(boxes+'/connect',{provider,mode:'history'})).url),scopes=auth.searchParams.get('scope').split(' ')
    assert.equal(scopes.some(scope=>/send|settings\.basic|write/i.test(scope)),false);assert.ok(scopes.includes(provider==='gmail'?'https://www.googleapis.com/auth/gmail.readonly':'Mail.Read'))
    const callback=`/api/management/mailboxes/oauth/${provider}/callback?state=${auth.searchParams.get('state')}&code=synthetic-happytohelp-1`
    assert.equal((await app.call(callback,{token:other.tokens.owner})).status,403)
    assert.equal((await app.call(callback,{token})).status,302)
    box=(await ok(boxes)).data.find(value=>value.provider===provider)
   }
   const initial=await snapshot()
   const cipher=(await app.first('SELECT credential_cipher FROM mailbox_connections WHERE id=?',box.id)).credential_cipher,[iv,data]=cipher.split('.')
   const key=await crypto.subtle.importKey('raw',Buffer.alloc(32,7),'AES-GCM',false,['decrypt']),credentials=JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(iv,'base64'),additionalData:Buffer.from(`${w.projectId}:mailbox:${box.id}`)},key,Buffer.from(data,'base64'))))
   assert.equal(Object.keys(credentials).some(key=>key.startsWith('smtp')),false,'no send credential in secret custody')
   assert.equal(box.mode,'history');assert.equal(box.addresses.every(value=>!value.can_send),true)
   assert.equal((await app.call(`${boxes}/${box.id}/history/folders`,{token:w.tokens.operator})).status,403)
   assert.equal((await app.call(`${boxes}/${box.id}/history/folders`,{token:w.tokens.admin})).status,403,'custom admin without integration permission cannot enumerate folders')
   const folders=(await ok(`${boxes}/${box.id}/history/folders`)).data;assert.ok(folders.some(folder=>folder.id==='Archive'))
   const prior=await app.first('SELECT count(*) n FROM conversations WHERE project_id=?',w.projectId)
   const read=await ok(`${boxes}/${box.id}/history`,{folders:['Archive','Sent']});assert.equal(read.messages,provider==='imap'?4:2)
   await app.drainJobs()
   const runId=read.data.id,runPath=`/api/move-in/projects/${w.projectId}/imports/${runId}`
   let review=(await ok(runPath)).data;assert.equal(review.state,'ready');assert.equal(review.error,null);assert.equal(review.plan.counts.rejected,0,JSON.stringify(review.plan))
   assert.equal((await app.first('SELECT count(*) n FROM conversations WHERE project_id=?',w.projectId)).n,prior.n,'review before native import')
   await ok(runPath+'/apply',{fingerprint:review.plan.fingerprint});await app.drainJobs()
   review=(await ok(runPath)).data;assert.equal(review.state,'completed',JSON.stringify(review));assert.equal(review.error,null)
   const conversations=await app.sql("SELECT c.* FROM conversations c JOIN move_in_conversations i ON i.conversation_id=c.id WHERE c.project_id=? AND i.vendor='mailbox'",w.projectId)
   assert.equal(conversations.length,prior.n+1)
   const latest=conversations.at(-1),rows=await app.sql('SELECT * FROM messages WHERE conversation_id=? ORDER BY revision',latest.id)
   assert.equal(rows.length,2);assert.match(rows[0].content,/café/);assert.ok(rows.every(m=>m.actor_role==='contact'))
   const media=await app.sql('SELECT * FROM media WHERE conversation_id=?',latest.id);assert.equal(media.length,2)
   const download=await app.request(`/api/conversations/${latest.id}/media/${media[0].id}`,{token});assert.equal(download.status,200);assert.match(await download.text(),/synthetic-happytohelp receipt/)
   const contact=await app.first('SELECT * FROM contacts WHERE id=?',latest.contact_id),visitor='synthetic-happytohelp-visitor-'+provider
   await app.db.prepare("INSERT INTO sessions(token_hash,actor_id,project_id,role,contact_id,expires_at) VALUES(?,?,?,'contact',?,?)").bind(sha(visitor),contact.id,w.projectId,contact.id,Date.now()+3600000).run()
   assert.equal((await app.call(`/api/conversations/${latest.id}`,{token:visitor})).status,404)
   assert.equal((await app.call(`/api/conversations/${latest.id}/messages`,{token:visitor})).status,404)
   const listed=await app.ok('/api/conversations',{token:visitor});assert.equal(listed.conversations.some(c=>c.id===latest.id),false)
   await app.db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(sha(visitor)).run()
   assert.equal((await app.first('SELECT count(*) n FROM conversation_outbox WHERE project_id=?',w.projectId)).n,0)
   assert.equal((await app.first('SELECT count(*) n FROM ticket_sla_state WHERE project_id=?',w.projectId)).n,0)
   assert.equal((await app.first('SELECT count(*) n FROM ai_generations WHERE project_id=?',w.projectId)).n,0)
   assert.deepEqual(await app.takeJobs(),[])
   for(const table of ['workflow_events','operator_notifications','notification_inbox','local_jobs'])assert.equal((await app.first(`SELECT count(*) n FROM ${table} WHERE project_id=?`,w.projectId)).n,0,table+' stays inert')
   const report=await ok(base.replace('/management/','/dashboard/')+'/reports?period=custom&start=2026-11-10&end=2026-11-11');assert.equal(report.volume,0,'history excluded from Reports')
   const beforeSend=requests.length,send=await app.call(`${base.replace('/management/','/dashboard/')}/tickets`,{token,body:{kind:'email',localId:'synthetic-happytohelp-send-'+provider,requesterEmail:'synthetic-happytohelp-refused@example.test',mailboxId:box.id,subject:'Must refuse',content:'Do not send'}})
   assert.ok(send.status>=400,JSON.stringify(send.data));assert.match(JSON.stringify(send.data),/Import history only|live mail/);assert.equal(requests.length,beforeSend)
   assert.equal((await app.call(`${boxes}/${box.id}/poll`,{token,body:{}})).status,409)
   const beforeRepeat=await snapshot()
   const repeat=await ok(`${boxes}/${box.id}/history`,{folders:['Archive','Sent']});await app.drainJobs();assert.equal(repeat.data.id,runId)
   assert.equal((await app.first('SELECT count(*) n FROM conversations WHERE project_id=?',w.projectId)).n,prior.n+1)
   assert.deepEqual(await snapshot(),beforeRepeat,'repeat preserves every imported business row')
   const beforeCron=requests.length;await app.scheduled();await app.drainJobs();assert.equal(requests.length,beforeCron,'history never polls in cron');const scheduledReads=requests.length-beforeCron
   if(browserProof&&provider==='imap')await browserProof({app,w,box})
   await ok(runPath+'/undo',{});await app.drainJobs();const undone=(await ok(runPath)).data;assert.equal(undone.state,'undone',JSON.stringify(undone));assert.equal(undone.error,null)
   assert.equal((await app.first('SELECT count(*) n FROM conversations WHERE project_id=?',w.projectId)).n,prior.n)
   assert.equal((await app.first('SELECT count(*) n FROM media WHERE project_id=?',w.projectId)).n,0)
   assert.deepEqual(await snapshot(),initial,'undo restores every imported business table exactly')
   if(provider==='gmail'){
    const again=await ok(`${boxes}/${box.id}/history`,{folders:['Archive','Sent']});assert.notEqual(again.data.id,runId,'reimport after undo has its own immutable journal');await app.drainJobs();const againPath=`/api/move-in/projects/${w.projectId}/imports/${again.data.id}`,againReview=(await ok(againPath)).data;assert.equal(againReview.state,'ready');await ok(againPath+'/apply',{fingerprint:againReview.plan.fingerprint});await app.drainJobs();assert.equal((await app.first('SELECT count(*) n FROM messages WHERE project_id=?',w.projectId)).n,raws.length);await ok(againPath+'/undo',{});await app.drainJobs();assert.deepEqual(await snapshot(),initial)
   }
   results.push({provider,sourceMessages:raws.length,importedThreads:1,importedMessages:rows.length,attachments:media.length,repeat:'no-op',undo:'exact',send:'refused',customerRead:'refused',scheduledReads})
   const publicState=JSON.stringify(await ok(boxes))+JSON.stringify(await app.sql('SELECT * FROM audit_events WHERE project_id=?',w.projectId))
   assert.equal(publicState.includes(secret),false);assert.equal(publicState.includes('must-not-store'),false)
   if(provider!=='imap'){
    const live=new URL((await ok(`${boxes}/${box.id}/live`,{})).url);assert.ok(/send/i.test(live.searchParams.get('scope')))
    // Do not complete consent: inspection of the later request must leave history mode intact.
    assert.equal((await ok(boxes)).data.find(b=>b.id===box.id).mode,'history')
    const broad=new URL((await ok(boxes+'/connect',{provider,mode:'history'})).url),beforeBroad=await app.first('SELECT credential_cipher FROM mailbox_connections WHERE id=?',box.id)
    assert.equal((await app.call(`/api/management/mailboxes/oauth/${provider}/callback?state=${broad.searchParams.get('state')}&code=synthetic-happytohelp-broad`,{token})).status,502,'a provider token with send permissions is never stored')
    assert.deepEqual(await app.first('SELECT credential_cipher FROM mailbox_connections WHERE id=?',box.id),beforeBroad)
    assert.equal((await app.call(`/api/management/mailboxes/oauth/${provider}/callback?state=${live.searchParams.get('state')}&code=synthetic-happytohelp-live`,{token})).status,302)
    const activated=(await ok(boxes)).data.find(b=>b.id===box.id);assert.equal(activated.mode,'live');assert.equal(activated.cursor,null);assert.ok(activated.addresses.some(a=>a.can_send))
    await app.ok(`${boxes}/${box.id}`,{token,method:'DELETE'})
   }
  }
  if(process.env.H2H_HISTORY_RECEIPT)await writeFile(process.env.H2H_HISTORY_RECEIPT,JSON.stringify({providers:results,mailboxMethods:[...new Set(requests.filter(r=>!r.path.endsWith('/token')&&r.path!=='/socket').map(r=>r.method))],imapCommands:[...new Set(commands)].filter(c=>c!=='LOGIN')},null,2)+'\n')
 }finally{await app.close()}
}
