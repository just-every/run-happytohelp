import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import {startApp} from '../../journeys/kit/app.mjs'
import {slackEdge} from './slack-edge.mjs'

const probe=(point,output)=>console.log(`PROBE NOTIFY-001 slack ${point}: ${JSON.stringify(output)}`)
const origin='https://app.example'

// NOTIFY-001 acceptance point 2, personal Slack leg. Consent, links and preferences go
// through the native routes; notices come from the ordinary ticket doors and are sent
// by the scheduled drain. Only Slack's own network edge is a fixture.
export async function slackNoticeJourney(){
 const edge=slackEdge(),app=await startApp({captureQueue:true,origin,bindings:{APP_ORIGIN:origin,INTEGRATION_ENCRYPTION_KEY:randomBytes(32).toString('base64')},outbound:edge.outbound})
 try{
  const w=await app.seedWorkspace('slack',{roles:['owner','admin','operator']}),p=w.projectId,base=`/api/management/projects/${p}`,desk=`/api/dashboard/projects/${p}`,slack=`${base}/teammate-slack`
  const owner={token:w.tokens.owner},opTok={token:w.tokens.operator},admin={token:w.tokens.admin}
  const req=(path,options)=>app.ok(path,options)
  const settle=async()=>{await app.scheduled();await app.scheduled(undefined,{after:61000})}
  const user=w.users.operator,adminId=w.users.admin
  const kinds=['assignment','customer_updated','group','follower','mention']
  const prefs=(enabled,token=opTok)=>req(slack+'/preferences',{...token,method:'PUT',body:{preferences:kinds.map(kind=>({kind,enabled}))}})
  const addMember=async(key,role='operator')=>{
   const id=`${key}-slack`,token=`${key}-token-slack`,{sha}=await import('../../journeys/kit/app.mjs'),now=Date.now()
   await app.db.batch([app.db.prepare('INSERT INTO users(id,email,name,created_at) VALUES(?,?,?,?)').bind(id,`${key}@example.test`,key,now),app.db.prepare('INSERT INTO memberships VALUES(?,?,?)').bind(p,id,role),app.db.prepare('INSERT INTO sessions(token_hash,actor_id,project_id,role,expires_at) VALUES(?,?,?,?,?)').bind(sha(token),id,p,role,now+3600000)])
   return {id,token:{token}}
  }
  // Tickets are opened by a real widget visitor and changed through the dashboard doors.
  const visitor=await req('/api/identity/widget/session',{headers:{Origin:w.allowedOrigin},body:{widgetKey:w.widgetKey,email:'customer-slack@example.test'}})
  const open=async()=>{const t=await req('/api/conversations',{token:visitor.token,body:{projectId:p}});await req(`/api/conversations/${t.id}/messages`,{token:visitor.token,body:{localId:'first-'+t.id,content:'Private subject line about order 1234 from Dana',expectedRevision:0}});return t.id}
  let serial=0
  const ticket=id=>req(`${desk}/conversations/${id}/ticket`,owner)
  const patch=async(id,changes)=>req(`${desk}/conversations/${id}/ticket`,{...owner,method:'PATCH',body:{expected_version:(await ticket(id)).data.ticket_version,...changes}})
  const customer=async id=>{const t=(await ticket(id)).data;return req(`/api/conversations/${id}/messages`,{token:visitor.token,body:{localId:'cu-'+(++serial),content:'Customer update '+serial+' with private details',expectedRevision:t.revision,expectedLastMessageId:t.last_message_id}})}
  const mention=(id,who)=>req(`${desk}/conversations/${id}/notes`,{...owner,body:{content:`Please review @[Agent](user:${who}) ${++serial}`,mention_ids:[who]}})
  const followers=(id,ids)=>req(`${desk}/conversations/${id}/followers`,{...owner,method:'PUT',body:{user_ids:ids}})
  const sentTo=channel=>edge.notices().filter(call=>call.params.channel===channel)
  const dm='D0OPERATOR1'
  const count=async(fn)=>{const before=edge.notices().length;await fn();await settle();return edge.notices().slice(before)}
  const quiet=async(label,fn)=>{const sent=await count(fn);assert.equal(sent.length,0,label);return sent}
  const t1=await open()
  await settle()

  // Off by default: no consent means no link, and an existing enabled Slack connection confers nothing.
  const destination=(await req(`${base}/connections/slack`,{...admin,body:{name:'Support Slack',mode:'bot',token:'xoxb-synthetic-bot-1',channel:'C0SYNTH1'}})).id
  edge.members.U0OPERATOR1=edge.installTeam
  assert.equal((await app.call(slack+'/link',{...opTok,body:{slack_user_id:'U0OPERATOR1'}})).status,409,'no consent, no link')
  assert.equal((await req(slack,opTok)).available,false);assert.match((await req(slack,opTok)).unavailable_reason,/not enabled/)
  assert.equal((await app.call(slack+'/consent',{...opTok,method:'PUT',body:{destination_id:destination}})).status,403,'an operator cannot give consent')
  assert.equal((await app.call(slack+'/consent',opTok)).status,403)
  await quiet('nothing is sent before consent',()=>patch(t1,{assigned_to:user}))
  await patch(t1,{assigned_to:null})
  await req(slack+'/consent',{...owner,method:'PUT',body:{destination_id:destination}})
  assert.deepEqual((await req(slack+'/consent',owner)).consent.destination_id,destination)

  // A typed ID or a member of another Slack team is never authority; the provider must place the member in this team.
  edge.members.U0OUTSIDER='T0OTHER'
  assert.equal((await app.call(slack+'/link',{...opTok,body:{slack_user_id:'U0OUTSIDER'}})).status,403,'foreign Slack team')
  assert.equal((await app.call(slack+'/link',{...opTok,body:{slack_user_id:'U0NOBODY1'}})).status,502,'unknown Slack member')
  assert.equal((await app.first('SELECT count(*) n FROM teammate_slack_links')).n,0,'a refused link stores nothing')
  assert.equal((await app.call(slack+'/link',{...opTok,body:{slack_user_id:'not an id'}})).status,400)
  // Notices committed before the link and the preference are never backfilled.
  await prefs(true);await patch(t1,{assigned_to:user})
  const unlinked=await count(async()=>{})
  assert.equal(unlinked.length,0,'preference without a verified link sends nothing')
  await patch(t1,{assigned_to:null});await settle()
  await req(slack+'/link',{...opTok,body:{slack_user_id:'U0OPERATOR1'}})
  assert.equal(edge.posts().at(-1).params.channel,dm,'the code goes to that member’s own Slack DM')
  assert.equal((await app.call(slack+'/link/verify',{...opTok,body:{code:'00000000'}})).status,400,'a wrong code does not verify')
  assert.equal((await settle(),edge.notices().length),0)
  await req(slack+'/link/verify',{...opTok,body:{code:edge.lastCode()}})
  // Another member cannot take over a verified identity, even holding the code.
  const rival=await addMember('rival');await req(slack+'/link',{...rival.token,body:{slack_user_id:'U0OPERATOR1'}})
  assert.equal((await app.call(slack+'/link/verify',{...rival.token,body:{code:edge.lastCode()}})).status,409,'one Slack identity maps to one member')
  await app.db.prepare('DELETE FROM teammate_slack_links WHERE user_id=?').bind(rival.id).run()
  await settle()
  assert.equal(edge.notices().length,0,'linking sends no backfilled notice')

  // Every native audience, through the ordinary doors, reaches only the linked recipient with the minimal payload.
  const group=(await req(desk+'/ticket-groups',{...owner,body:{name:'Slack team',members:[user]}})).data
  const t2=await open()
  const doors={
   assignment:()=>patch(t2,{assigned_to:user}),
   customer_updated:()=>customer(t2),
   mention:()=>mention(t2,user),
   follower:async()=>{await patch(t2,{assigned_to:null});await followers(t2,[user])},
   group:async()=>{await followers(t2,[]);await patch(t2,{group_id:group.id});await customer(t2)},
  }
  const seen={}
  for(const kind of ['assignment','customer_updated','mention','follower','group']){
   if(kind==='follower'||kind==='group'){await doors[kind]();await settle()}
   const sent=await count(kind==='follower'||kind==='group'?()=>customer(t2):doors[kind])
   assert.ok(sent.length>=1,kind+' reaches Slack')
   assert.deepEqual([...new Set(sent.map(call=>call.params.channel))],[dm],kind+' reaches only the intended recipient')
   seen[kind]=sent.length
  }
  probe('P1 audiences',seen)
  const payloads=edge.notices()
  for(const call of payloads){
   assert.equal(call.token,'xoxb-synthetic-bot-1');assert.deepEqual(Object.keys(call.params).sort(),['blocks','channel','mrkdwn','text','unfurl_links','unfurl_media'])
   const text=JSON.stringify(call.params)
   assert.match(text,new RegExp(`${origin}/projects/${p}/conversations/${t2}`));assert.ok(text.includes(t2))
   for(const secret of ['Private subject','Dana','order 1234','customer-slack@example.test','private details','Customer update'])assert.ok(!text.includes(secret),'payload carries no '+secret)
  }
  const outcomes=(await req(slack+'/outcomes',opTok)).data
  assert.ok(outcomes.length>=5&&outcomes.every(row=>row.state==='accepted'),'the recipient reads accepted outcomes');probe('P1 outcomes',outcomes.map(row=>row.state))

  // Preference off, and inbox/email untouched: nothing is sent.
  await req(slack+'/preferences',{...opTok,method:'PUT',body:{preferences:[{kind:'mention',enabled:false}]}})
  await quiet('mention preference off sends nothing',()=>mention(t2,user))
  await req(slack+'/preferences',{...opTok,method:'PUT',body:{preferences:[{kind:'mention',enabled:true}]}})
  const inboxRows=(await req(base+'/notification-inbox',opTok)).data.length
  assert.ok(inboxRows>0,'the inbox leg still has its rows')

  // The kind's relation is rechecked at send time: a notice whose audience changed before the drain is not sent.
  const t5=await open();await followers(t5,[user]);await customer(t5);await followers(t5,[]);await quiet('an unfollowed ticket sends nothing',async()=>{})
  const t6=await open();await patch(t6,{assigned_to:user});await patch(t6,{assigned_to:null});await quiet('a reassigned ticket sends nothing',async()=>{})
  assert.ok((await app.first("SELECT count(*) n FROM notification_inbox WHERE user_id=? AND conversation_id IN (?,?)",user,t5,t6)).n>=2,'the frozen leg did write those notices')
  probe('P2b relation',{unfollowed:0,reassigned:0})

  // Source rows: workflow/SLA action rows, escalation and follow-up rows never reach Slack.
  const now=Date.now()+1000
  for(const [id,state] of [[`ticket-notice:${p}:${t2}:wf:inbox:${user}`,'action'],[`escalation:${p}:${t2}:x`,'pending'],[`followup:${p}:${t2}:y`,'pending'],[`other:${p}:${t2}:z`,'pending']])
   await app.db.prepare("INSERT INTO notification_inbox(id,project_id,conversation_id,user_id,kind,inbox,email,state,created_at) VALUES(?,?,?,?,'follower',1,0,?,?)").bind(id,p,t2,user,state,now).run()
  await followers(t2,[user]);await settle()
  assert.ok(edge.notices().length-payloads.length<=1,'only the genuine follower notice was sent')
  assert.equal((await app.first("SELECT count(*) n FROM teammate_slack_deliveries WHERE notice_id NOT LIKE 'team-notice:%' AND notice_id NOT LIKE 'assignment:%'")).n,0,'no delivery row exists for any other id form')
  probe('P2 sources',{blocked:4})

  // Role scope: a notice row may exist for a narrowed operator, but Slack never carries a hidden ticket.
  const scoped=await addMember('scoped'),g1=(await req(desk+'/ticket-groups',{...owner,body:{name:'Visible',members:[scoped.id]}})).data,g2=(await req(desk+'/ticket-groups',{...owner,body:{name:'Hidden',members:[scoped.id]}})).data
  const role=(await req(base+'/roles',{...owner,body:{name:'Scoped support',base:'operator',permissions:['conversations.reply','conversations.manage','reports.view']}})).data.id
  await req(`${base}/agents/${scoped.id}`,{...owner,method:'PUT',body:{role}})
  edge.members.U0SCOPED01=edge.installTeam
  await req(slack+'/link',{...scoped.token,body:{slack_user_id:'U0SCOPED01'}});await req(slack+'/link/verify',{...scoped.token,body:{code:edge.lastCode()}});await prefs(true,scoped.token)
  const hidden=await open();await patch(hidden,{group_id:g2.id,assigned_to:scoped.id})
  await app.db.prepare('UPDATE project_roles SET ticket_scope_json=? WHERE project_id=? AND id=?').bind(JSON.stringify({groupIds:[g1.id],includeUngrouped:false}),p,role).run()
  await quiet('a role scope that excludes the ticket sends nothing',()=>customer(hidden))
  const hiddenRows=(await app.first('SELECT count(*) n FROM notification_inbox WHERE user_id=? AND conversation_id=?',scoped.id,hidden)).n
  assert.equal((await req(slack+'/outcomes',scoped.token)).data.filter(row=>row.conversation_id===hidden).length,0)
  probe('P3 scope',{noticeRowsMadeByFrozenLeg:hiddenRows,slack:0})

  // A revoked member gets nothing.
  const leaver=await addMember('leaver');edge.members.U0LEAVER01=edge.installTeam
  await req(slack+'/link',{...leaver.token,body:{slack_user_id:'U0LEAVER01'}});await req(slack+'/link/verify',{...leaver.token,body:{code:edge.lastCode()}});await prefs(true,leaver.token)
  const t3=await open();await patch(t3,{assigned_to:leaver.id})
  await settle();const before=edge.notices().filter(call=>call.params.channel==='D0LEAVER01').length
  await req(`${base}/agents/${leaver.id}`,{...owner,method:'DELETE'})
  await quiet('a revoked member gets nothing',()=>customer(t3))
  assert.equal(edge.notices().filter(call=>call.params.channel==='D0LEAVER01').length,before)
  assert.equal((await app.first('SELECT count(*) n FROM teammate_slack_links WHERE user_id=?',leaver.id)).n,0,'membership removal removes the link')

  // Rate limiting is the only retry, at most five attempts; a lost response is uncertain and never replayed.
  const t4=await open();await patch(t4,{assigned_to:user});await settle()
  const attemptsBefore=edge.notices().length;edge.script.push('rate')
  await customer(t4);await app.scheduled();assert.equal(edge.notices().length-attemptsBefore,1)
  assert.equal((await app.first("SELECT state FROM teammate_slack_deliveries ORDER BY created_at DESC LIMIT 1")).state,'pending')
  await app.scheduled(undefined,{after:61000});assert.equal(edge.notices().length-attemptsBefore,2,'one retry after the rate limit cooled');
  assert.equal((await app.first("SELECT state FROM teammate_slack_deliveries ORDER BY created_at DESC LIMIT 1")).state,'accepted')
  edge.script.push('rate','rate','rate','rate','rate');const capped=edge.notices().length
  await customer(t4);await app.scheduled()
  for(const after of [70000,400000,1000000,3700000])await app.scheduled(undefined,{after})
  await app.scheduled(undefined,{after:8000000});assert.equal(edge.notices().length-capped,5,'at most five attempts in total')
  assert.equal((await app.first("SELECT state FROM teammate_slack_deliveries ORDER BY created_at DESC LIMIT 1")).state,'failed')
  edge.script.push('lost');const lostAt=edge.notices().length
  await customer(t4);await settle()
  const lost=await app.first("SELECT notice_id,state FROM teammate_slack_deliveries ORDER BY created_at DESC LIMIT 1")
  assert.equal(lost.state,'uncertain');assert.equal(edge.notices().length-lostAt,1)
  await app.configure({});await settle();await app.scheduled(undefined,{after:4000000})
  assert.equal(edge.notices().length-lostAt,1,'a restart never sends an uncertain notice again')
  assert.equal((await app.first('SELECT state FROM teammate_slack_deliveries WHERE notice_id=?',lost.notice_id)).state,'uncertain')
  assert.equal((await req(slack+'/outcomes',opTok)).data.find(row=>row.id===lost.notice_id).state,'uncertain')
  probe('P4 outcomes',{retry:'rate-limit only, 5 max',lost:'uncertain, not replayed after restart'})

  // Consent revoked, installer authority lost and a disabled destination each stop the send.
  await req(slack+'/consent',{...owner,method:'PUT',body:{destination_id:null}})
  await quiet('revoked consent stops the send',()=>customer(t4))
  assert.equal((await app.first('SELECT count(*) n FROM teammate_slack_links')).n,0,'revoking consent removes every link')
  const second=(await req(`${base}/connections/slack`,{...admin,body:{name:'Second Slack',mode:'bot',token:'xoxb-synthetic-bot-2',channel:'C0SYNTH2'}})).id
  const relink=async()=>{await req(slack+'/link',{...opTok,body:{slack_user_id:'U0OPERATOR1'}});await req(slack+'/link/verify',{...opTok,body:{code:edge.lastCode()}});await prefs(true)}
  await app.db.prepare('DELETE FROM teammate_slack_links').run()
  await req(slack+'/consent',{...owner,method:'PUT',body:{destination_id:second}});await relink()
  const live=await count(()=>customer(t4));assert.equal(live.length,1,'a fresh consent, link and preference deliver again')
  await app.db.prepare('UPDATE teammate_slack_links SET created_at=1').run()
  await req(`${base}/agents/${adminId}`,{...owner,method:'DELETE'})
  await quiet('lost installer authority stops the send',()=>customer(t4))
  const third=(await req(`${base}/connections/slack`,{...owner,body:{name:'Third Slack',mode:'bot',token:'xoxb-synthetic-bot-3',channel:'C0SYNTH3'}})).id
  await req(slack+'/consent',{...owner,method:'PUT',body:{destination_id:third}});await relink()
  assert.equal((await count(()=>customer(t4))).length,1)
  await req(`${base}/connections/slack/${third}`,{...owner,method:'DELETE'})
  await quiet('a disabled destination stops the send',()=>customer(t4))
  assert.match((await req(slack,opTok)).unavailable_reason,/disabled or removed/)
  probe('P5 authority',{consent:'revoked',installer:'removed',destination:'disabled'})

  // Erasure: the customer's erasure removes the delivery outcomes with their notices; a member's erasure removes link, consent and preferences.
  const delivered=(await app.first('SELECT count(*) n FROM teammate_slack_deliveries')).n
  assert.ok(delivered>0)
  await req(`${base}/contacts/${(await app.first('SELECT contact_id FROM conversations WHERE id=?',t4)).contact_id}/erase`,{...owner,body:{}})
  const afterContact=(await app.first('SELECT count(*) n FROM teammate_slack_deliveries')).n
  assert.equal((await req(slack+'/outcomes',opTok)).data.length,0,'the recipient no longer reads an erased customer’s outcomes')
  const rows=async()=>(await app.first('SELECT (SELECT count(*) FROM teammate_slack_links WHERE user_id=?1)+(SELECT count(*) FROM teammate_slack_preferences WHERE user_id=?1)+(SELECT count(*) FROM teammate_slack_deliveries WHERE user_id=?1) n',user)).n
  assert.ok(await rows()>0)
  await req(`${base}/agents/${user}/erase`,{...owner,method:'POST'})
  assert.equal(await rows(),0,'member erasure removes the Slack preferences, link and outcomes')
  probe('P6 erasure',{deliveriesBeforeContactErasure:delivered,afterContactErasure:afterContact,memberRowsAfter:0})

  // Foreign workspace: another workspace's owner has no link, consent or outcome door here.
  const foreign=await app.seedWorkspace('slack-foreign')
  for(const path of [slack,slack+'/outcomes',slack+'/consent'])assert.equal((await app.call(path,{token:foreign.tokens.owner})).status,403,'a foreign workspace member reads nothing')
  assert.equal((await app.call(slack+'/link',{token:foreign.tokens.owner,body:{slack_user_id:'U0OPERATOR1'}})).status,403)
  // Outbound only: no inbound Slack door exists.
  for(const path of ['/api/slack/events','/api/slack/interactive','/api/integrations/slack'])assert.ok([404,405].includes((await app.call(path,{body:{}})).status))
 }finally{await app.close()}
}
