import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import {startApp,sha} from '../../journeys/kit/app.mjs'
import {teamsEdge} from './teams-edge.mjs'
const probe=(point,output)=>console.log(`PROBE NOTIFY-001 teams ${point}: ${JSON.stringify(output)}`)
export async function teamsNoticeJourney(){
 const edge=teamsEdge(),app=await startApp({cf:{},captureQueue:true,origin:'https://app.example',bindings:{APP_ORIGIN:'https://app.example',INTEGRATION_ENCRYPTION_KEY:randomBytes(32).toString('base64')},outbound:edge.outbound})
 try{
  const w=await app.seedWorkspace('teams'),p=w.projectId,base=`/api/management/projects/${p}`,desk=`/api/dashboard/projects/${p}`,path=base+'/teammate-teams',channel=`/api/support-channels/projects/${p}`
  const owner={token:w.tokens.owner},op={token:w.tokens.operator},admin={token:w.tokens.admin},user=w.users.operator
  const req=(url,options)=>app.ok(url,options),kinds=['assignment','customer_updated','group','follower','mention']
  const consent=connection_id=>req(path+'/consent',{...owner,method:'PUT',body:{connection_id}})
  const prefs=(enabled,actor=op)=>req(path+'/preferences',{...actor,method:'PUT',body:{preferences:kinds.map(kind=>({kind,enabled}))}})
  const connect=async(actor=admin,extra={})=>(await req(channel+'/connections',{...actor,body:{provider:'teams',account:edge.tenant,sender:edge.appId,token:'synthetic-hh-bot-secret',signing_secret:'synthetic-hh-bot-signing',channels:['19:synthetic-hh-customer-channel'],...extra}})).data
  const connection=await connect()
  const deliver=(body,claims={})=>app.call('/api/support-channels/webhooks/'+connection.id,{raw:true,body:JSON.stringify(body),headers:edge.signed(body,claims)})
  const newCode=async(actor=op)=>(await req(path+'/link',{...actor,method:'POST'})).code
  const link=async(actor=op,sender='synthetic-hh-member')=>{const code=await newCode(actor);assert.equal((await deliver(edge.event({code,sender}))).status,200)}
  const settle=async()=>{await app.scheduled();await app.scheduled(undefined,{after:61000})}
  const ticket=id=>req(`${desk}/conversations/${id}/ticket`,owner)
  const patch=async(id,changes)=>req(`${desk}/conversations/${id}/ticket`,{...owner,method:'PATCH',body:{expected_version:(await ticket(id)).data.ticket_version,...changes}})
  const visitor=await req('/api/identity/widget/session',{headers:{Origin:w.allowedOrigin},body:{widgetKey:w.widgetKey,email:'synthetic-hh-customer@example.test'}})
  const open=async()=>{const t=await req('/api/conversations',{token:visitor.token,body:{projectId:p}});await req(`/api/conversations/${t.id}/messages`,{token:visitor.token,body:{localId:'first-'+t.id,content:'Confidential customer issue about Dana',expectedRevision:0}});return t.id}
  let serial=0
  const customer=async id=>{const t=(await ticket(id)).data;await req(`/api/conversations/${id}/messages`,{token:visitor.token,body:{localId:'cu-'+(++serial),content:'Private update '+serial,expectedRevision:t.revision,expectedLastMessageId:t.last_message_id}})}
  const mention=(id,who=user)=>req(`${desk}/conversations/${id}/notes`,{...owner,body:{content:`Private note @[Agent](user:${who}) ${++serial}`,mention_ids:[who]}})
  const followers=(id,ids)=>req(`${desk}/conversations/${id}/followers`,{...owner,method:'PUT',body:{user_ids:ids}})
  const count=async action=>{const before=edge.calls.length;await action();await settle();return edge.calls.slice(before)}
  const quiet=async(label,action=async()=>{})=>assert.equal((await count(action)).length,0,label)
  const addMember=async name=>{const id='synthetic-hh-'+name,token=id+'-session',now=Date.now();await app.db.batch([app.db.prepare('INSERT INTO users(id,email,name,created_at) VALUES(?,?,?,?)').bind(id,name+'@example.test',name,now),app.db.prepare('INSERT INTO memberships VALUES(?,?,?)').bind(p,id,'operator'),app.db.prepare('INSERT INTO sessions(token_hash,actor_id,project_id,role,expires_at) VALUES(?,?,?,?,?)').bind(sha(token),id,p,'operator',now+3600000)]);return {id,token:{token}}}
  const t=await open();await settle()
  assert.equal((await req(path,op)).available,false)
  assert.equal((await app.call(path+'/link',{...op,method:'POST'})).status,409)
  for(const method of ['GET','PUT'])assert.equal((await app.call(path+'/consent',{...op,method,...(method==='PUT'?{body:{connection_id:connection.id}}:{})})).status,403)
  await consent(connection.id)
  await prefs(true);await quiet('no personal conversation means no delivery',()=>patch(t,{assigned_to:user}))
  const code=await newCode(),saved=await app.first('SELECT * FROM teammate_teams_codes WHERE user_id=?',user)
  assert.equal(saved.token_hash,sha(code));assert.equal(saved.expires_at<=Date.now()+600000,true);assert.ok(!Object.values(saved).includes(code),'only the code hash persists')
  const baseline=await app.first('SELECT (SELECT count(*) FROM contacts) contacts,(SELECT count(*) FROM conversations) conversations,(SELECT count(*) FROM support_channel_threads) threads,(SELECT count(*) FROM support_channel_members) members')
  for(const [body,claims] of [[edge.event({code,channelData:{tenant:{id:'foreign'}}}),{}],[edge.event({code}),{aud:'wrong'}],[edge.event({code}),{iss:'wrong'}],[edge.event({code}),{serviceurl:edge.service+'wrong'}],[edge.event({code,conversation:{id:'synthetic-channel',conversationType:'channel'}}),{}]])assert.ok([401,403].includes((await deliver(body,claims)).status))
  assert.equal((await app.first('SELECT count(*) n FROM teammate_teams_links')).n,0)
  const raw=edge.event({code,text:`<at>Bot</at> notify link ${code}`})
  assert.equal((await deliver(raw)).status,200)
  assert.equal((await deliver(raw)).status,403,'a used code cannot link twice')
  assert.deepEqual(await app.first('SELECT (SELECT count(*) FROM contacts) contacts,(SELECT count(*) FROM conversations) conversations,(SELECT count(*) FROM support_channel_threads) threads,(SELECT count(*) FROM support_channel_members) members'),baseline,'personal linking confers no intake or command authority')
  await quiet('no notices from before linking are backfilled')
  const rival=await addMember('rival'),rivalCode=await newCode(rival.token)
  assert.equal((await deliver(edge.event({code:rivalCode}))).status,409,'one Teams identity cannot claim two members')
  const expired=await newCode(rival.token);await app.db.prepare('UPDATE teammate_teams_codes SET expires_at=1 WHERE user_id=?').bind(rival.id).run()
  assert.equal((await deliver(edge.event({code:expired,sender:'synthetic-hh-rival'}))).status,403)
  const ended=await newCode(rival.token);await app.db.prepare('UPDATE sessions SET revoked_at=? WHERE token_hash=?').bind(Date.now(),sha(rival.token.token)).run()
  assert.equal((await deliver(edge.event({code:ended,sender:'synthetic-hh-rival'}))).status,403,'another live session cannot rescue a code whose issuing session ended')
  // Separate phrases and tables never confer the other authority.
  const supportCode=(await req(channel+'/connections/'+connection.id+'/link-code',{...owner,body:{}})).data.code
  assert.equal((await deliver(edge.event({code:supportCode,sender:'synthetic-hh-owner'}))).status,403)
  const personalCode=await newCode()
  assert.equal((await deliver(edge.event({text:'support link '+personalCode}))).status,403)
  assert.equal((await app.first('SELECT count(*) n FROM support_channel_members')).n,0)
  probe('link',{authenticated:true,hashed:true,singleUse:true,expires:true,sessionBound:true,noIntake:true})

  const g=(await req(desk+'/ticket-groups',{...owner,body:{name:'Teams group',members:[user]}})).data
  const ticketId=await open()
  const seen={}
  seen.assignment=(await count(()=>patch(ticketId,{assigned_to:user}))).length
  seen.customer_updated=(await count(()=>customer(ticketId))).length
  seen.mention=(await count(()=>mention(ticketId))).length
  await patch(ticketId,{assigned_to:null});await followers(ticketId,[user]);await settle()
  seen.follower=(await count(()=>customer(ticketId))).length
  await followers(ticketId,[]);await patch(ticketId,{group_id:g.id});await settle()
  seen.group=(await count(()=>customer(ticketId))).length
  assert.deepEqual(seen,{assignment:1,customer_updated:1,mention:1,follower:1,group:1})
  for(const call of edge.calls){assert.equal(new URL(call.url).pathname,'/amer/v3/conversations/synthetic-hh-personal/activities');assert.deepEqual(Object.keys(call.body).sort(),['text','textFormat','type']);assert.equal(call.body.textFormat,'plain');assert.match(call.body.text,/Ticket [a-z0-9-]+\nOpen: https:\/\/app.example\/projects\//);for(const secret of ['Confidential','Dana','Private','@example.test'])assert.ok(!JSON.stringify(call.body).includes(secret))}
  assert.ok((await req(path+'/outcomes',op)).data.every(row=>row.state==='accepted'))
  probe('audiences',seen)
  await prefs(false);await quiet('off preference',()=>mention(ticketId));await prefs(true)
  // Current relation check on a committed native notice.
  const moved=await open();await patch(moved,{assigned_to:user});await patch(moved,{assigned_to:null});await quiet('assignment relation lost before drain')
  await followers(moved,[user]);await customer(moved);await followers(moved,[]);await quiet('follower relation lost before drain')
  const now=Date.now()+1000
  for(const [id,state] of [['ticket-notice:synthetic-hh','action'],['escalation:synthetic-hh','pending'],['followup:synthetic-hh','pending'],['unknown:synthetic-hh','pending']])await app.db.prepare("INSERT INTO notification_inbox(id,project_id,conversation_id,user_id,kind,inbox,email,state,created_at) VALUES(?,?,?,?,'mention',1,0,?,?)").bind(id,p,ticketId,user,state,now).run()
  await quiet('non-teammate sources are never sent')
  assert.equal((await app.first("SELECT count(*) n FROM teammate_teams_deliveries WHERE notice_id NOT LIKE 'team-notice:%' AND notice_id NOT LIKE 'assignment:%'")).n,0)
  // Scope and current membership, using a role created/assigned by ordinary doors.
  const scoped=await addMember('scoped'),role=(await req(base+'/roles',{...owner,body:{name:'Scoped Teams',base:'operator',permissions:['conversations.reply','conversations.manage']}})).data.id
  await req(base+'/agents/'+scoped.id,{...owner,method:'PUT',body:{role}});await link(scoped.token,'synthetic-hh-scoped');await prefs(true,scoped.token)
  const hidden=await open();await patch(hidden,{assigned_to:scoped.id});await app.db.prepare('UPDATE project_roles SET ticket_scope_json=? WHERE id=? AND project_id=?').bind(JSON.stringify({groupIds:[],includeUngrouped:false}),role,p).run()
  await quiet('scope excludes the ticket',()=>customer(hidden));assert.deepEqual((await req(path+'/outcomes',scoped.token)).data,[])
  const leaver=await addMember('leaver');await link(leaver.token,'synthetic-hh-leaver');await prefs(true,leaver.token)
  const left=await open();await patch(left,{assigned_to:leaver.id});await req(base+'/agents/'+leaver.id,{...owner,method:'DELETE'});await quiet('revoked member receives nothing',()=>customer(left))
  assert.equal((await app.first('SELECT count(*) n FROM teammate_teams_links WHERE user_id=?',leaver.id)).n,0)
  const foreign=await app.seedWorkspace('teams-foreign')
  for(const door of [path,path+'/outcomes',path+'/consent'])assert.equal((await app.call(door,{token:foreign.tokens.owner})).status,403)
  probe('guards',{preference:true,relation:true,source:true,scope:true,revokedMember:true,foreignWorkspace:true})

  await patch(ticketId,{assigned_to:user,group_id:null});await settle()
  // Only a 429 schedules a retry; Retry-After is honored and all attempts are bounded.
  edge.script.push('rate');let before=edge.calls.length;await customer(ticketId);await app.scheduled()
  assert.equal(edge.calls.length-before,1);await app.scheduled(undefined,{after:61000});assert.equal(edge.calls.length-before,1,'Retry-After 120s')
  await app.scheduled(undefined,{after:121000});assert.equal(edge.calls.length-before,2)
  edge.script.push('rate','rate','rate','rate','rate');before=edge.calls.length;await customer(ticketId);await app.scheduled()
  for(const after of [130000,500000,1500000,5500000,9500000])await app.scheduled(undefined,{after})
  assert.equal(edge.calls.length-before,5)
  for(const answer of ['lost',500,'unreadable']){
   edge.script.push(answer);before=edge.calls.length;await customer(ticketId);await settle()
   const outcome=await app.first('SELECT notice_id,state FROM teammate_teams_deliveries ORDER BY created_at DESC,rowid DESC LIMIT 1');assert.equal(outcome.state,'uncertain');assert.equal(edge.calls.length-before,1)
   await app.configure({});await settle();await app.scheduled(undefined,{after:4000000});assert.equal(edge.calls.length-before,1);assert.equal((await app.first('SELECT state FROM teammate_teams_deliveries WHERE notice_id=?',outcome.notice_id)).state,'uncertain')
  }
  edge.tokenScript.push('failed');before=edge.calls.length;await customer(ticketId);await settle();assert.equal(edge.calls.length,before);assert.equal((await app.first('SELECT state FROM teammate_teams_deliveries ORDER BY created_at DESC,rowid DESC LIMIT 1')).state,'failed')
  edge.script.push(403);before=edge.calls.length;await customer(ticketId);await settle();assert.equal(edge.calls.length-before,1);assert.equal((await app.first('SELECT state FROM teammate_teams_deliveries ORDER BY created_at DESC,rowid DESC LIMIT 1')).state,'failed')
  // Revocation during the token request is caught by the final SQL recheck.
  edge.tokenScript.push(async()=>prefs(false));await quiet('pre-send preference recheck',()=>customer(ticketId));await prefs(true)
  probe('outcomes',{rateAttempts:5,retryAfter:true,unknown:'terminal across restart',beforeSendFailure:'failed',preSendRecheck:true})

  await consent(null);await quiet('consent revoked',()=>customer(ticketId));assert.equal((await app.first('SELECT count(*) n FROM teammate_teams_links')).n,0)
  await consent(connection.id);await link();await prefs(true)
  await app.db.prepare("DELETE FROM audit_events WHERE action='support_channel.connected' AND target_id=?").bind(connection.id).run()
  await quiet('missing installer evidence fails closed',()=>customer(ticketId));assert.match((await req(path,op)).unavailable_reason,/administrator must reconnect/)
  await connect();await link();await prefs(true)
  await req(base+'/agents/'+w.users.admin,{...owner,method:'DELETE'});await quiet('installer lost authority',()=>customer(ticketId))
  await connect(owner);await link();await prefs(true)
  assert.equal((await count(()=>customer(ticketId))).length,1)
  await req(channel+'/connections/'+connection.id,{...owner,method:'DELETE'});await quiet('connection revoked',()=>customer(ticketId));assert.equal((await req(path,op)).available,false)
  await req(path+'/link',{...op,method:'DELETE'});assert.equal((await app.first('SELECT count(*) n FROM teammate_teams_links WHERE user_id=?',user)).n,0,'unlink works even while unavailable')
  // Member erasure removes every member-bearing Teams row; contact erasure cascades outcomes.
  await connect(owner);await link();await prefs(true);await customer(ticketId);await settle()
  const contact=(await app.first('SELECT contact_id FROM conversations WHERE id=?',ticketId)).contact_id
  await req(base+'/contacts/'+contact+'/erase',{...owner,body:{}})
  assert.deepEqual((await req(path+'/outcomes',op)).data,[])
  await req(base+'/agents/'+user+'/erase',{...owner,body:{}})
  for(const table of ['teammate_teams_links','teammate_teams_codes','teammate_teams_preferences','teammate_teams_deliveries'])assert.equal((await app.first(`SELECT count(*) n FROM ${table} WHERE user_id=?`,user)).n,0)
  probe('authority-erasure',{consentRevoked:true,missingInstallerUnavailable:true,installerRevoked:true,connectionRevoked:true,memberRows:0})
 }finally{await app.close()}
}
