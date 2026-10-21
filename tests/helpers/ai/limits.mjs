import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {startApp} from '../../journeys/kit/app.mjs'
import {openaiStream} from '../openai-stream.mjs'
import {awaitWindowRoom} from '../window-room.mjs'

const sha=value=>createHash('sha256').update(value).digest('hex')
// The real application with configured limits. Outbound calls fail the test except the mail provider
// and, where a reply runs, the model provider reporting enough usage to pass a $0.05 spend ceiling.
async function start(bindings,outbound=[]){
 const app=await startApp({captureQueue:true,origin:'https://app.example',bindings,outbound:async request=>{outbound.push(request.url);if(request.url==='https://api.resend.com/emails')return Response.json({id:'fixture-'+outbound.length});if(new URL(request.url).hostname==='api.openai.com')return openaiStream('Paid answer',{input_tokens:300000,output_tokens:0});return new Response('Unexpected outbound request in test',{status:599})}})
 const call=(path,{body,token,ip,origin,method,headers={}}={})=>app.request(path,{method:method||(body===undefined?'GET':'POST'),raw:true,headers:{...(body!==undefined&&!(body instanceof Uint8Array)?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{}),...(ip?{'CF-Connecting-IP':ip}:{}),...(origin?{Origin:origin}:{}),...headers},body:body===undefined?undefined:body instanceof Uint8Array?body:JSON.stringify(body)})
 return {app,db:app.db,call}
}
async function seedProject(db,id,{ai=false}={}){
 const now=Date.now()
 await db.prepare('INSERT INTO projects(id,name,widget_key,allowed_origin,created_at) VALUES(?,?,?,?,?)').bind(id,'Project '+id,'widget-'+id,`https://${id}.example`,now).run()
 await db.prepare('INSERT INTO users(id,email,name,created_at) VALUES(?,?,?,?)').bind('owner-'+id,`owner-${id}@example.com`,'Owner '+id,now).run()
 await db.prepare("INSERT INTO memberships VALUES(?,?,'owner')").bind(id,'owner-'+id).run()
 await db.prepare("INSERT INTO sessions(token_hash,actor_id,project_id,role,expires_at) VALUES(?,?,?,'owner',?)").bind(sha('token-'+id),'owner-'+id,id,now+3600000).run()
 if(ai)await db.prepare('INSERT INTO ai_profiles VALUES(?,?,?,?,?,?,1,0,NULL,?)').bind('ai-'+id,id,'Assistant','support','Answer from evidence','gpt-5.6-luna',now).run()
 // These teams answer without the dashboard open: presence-based away (tests/helpers/widget/presence.mjs) is off.
 await db.prepare('INSERT INTO project_settings(project_id,settings_json,updated_at) VALUES(?,?,?)').bind(id,JSON.stringify({is_presence_away_enabled:false,...(ai?{default_visitor_ai_id:'ai-'+id}:{})}),now).run()
 return {id,widgetKey:'widget-'+id,origin:`https://${id}.example`,ownerToken:'token-'+id}
}
async function expectLimited(response,limit){
 const text=await response.text()
 assert.equal(response.status,429,text)
 const body=JSON.parse(text),retryAfter=Number(response.headers.get('Retry-After'))
 assert.equal(body.code,'rate_limited');assert.equal(body.limit,limit);assert.ok(body.error.length>10,'a visitor-readable message')
 assert.ok(Number.isInteger(retryAfter)&&retryAfter>=1,`Retry-After ${response.headers.get('Retry-After')}`);assert.equal(body.retryAfter,retryAfter)
 return {body,retryAfter}
}

// A visitor's explicit AI request over a daily ceiling: 429 until 00:00 UTC, a visitor-safe
// message, and nothing about which ceiling was reached or what the project spent.
const operatorOnly=/AI_REPLY_CEILING|ceiling|spend|\$|repliesPer|AI_DAILY_CEILINGS|installation/i
const untilUtcMidnight=now=>Math.ceil((Math.floor(now/86400000+1)*86400000-now)/1000)
async function expectAiRefused(send,origin){
 const earliest=untilUtcMidnight(Date.now()),response=await send(),latest=untilUtcMidnight(Date.now()),text=await response.text()
 assert.equal(response.status,429,text)
 const body=JSON.parse(text),retryAfter=Number(response.headers.get('Retry-After'))
 assert.ok(Number.isInteger(retryAfter)&&retryAfter>=latest&&retryAfter<=earliest,`Retry-After ${retryAfter} is the time until 00:00 UTC (${latest}..${earliest})`)
 assert.equal(body.retryAfter,retryAfter);assert.equal(body.code,'rate_limited');assert.ok(body.error.length>10,'a visitor-readable message')
 assert.doesNotMatch(text,operatorOnly,'no ceiling reason or spend reaches the visitor')
 for(const [name,value] of response.headers)assert.doesNotMatch(`${name}: ${value}`,/AI_REPLY_CEILING|spend|\$/i)
 assert.equal(response.headers.get('Access-Control-Allow-Origin'),origin,'the widget can read the refusal cross-origin')
 return body
}


// Public request limits per project, address, contact and conversation, refusals that store nothing, hashed keys.
export async function requestLimits(){
 const outbound=[]
 const {app,db,call}=await start({
  RATE_LIMITS:JSON.stringify({widgetSessionsPerIpHour:3,conversationsPerContactHour:2,conversationsPerIpHour:3,messagesPerConversationMinute:3,messagesPerContactHour:5,uploadsPerContactDay:2,uploadBytesPerContactDay:1000,widgetEventsPerContactMinute:4,registrationsPerIpDay:2,projectsPerIpDay:3,projectsPerAccountDay:2}),
  REGISTRATION_ENABLED:'true',APP_ORIGIN:'https://app.example',EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'test-only-email-key',EMAIL_FROM:'support@example.com',
 },outbound)
 try{
  const one=await seedProject(db,'one'),two=await seedProject(db,'two')
  const session=async(project,ip,ok=201)=>{const response=await call('/api/identity/widget/session',{body:{widgetKey:project.widgetKey},ip,origin:project.origin});if(ok!==null)assert.equal(response.status,ok,await response.clone().text());return response}
  const contacts=async()=>(await db.prepare('SELECT count(*) n FROM contacts').first()).n

  // Each section below is a burst against its own counters; none may straddle a window boundary.
  // Session creation: a non-browser client can present the allowed Origin, so admission is bounded per widget key and address.
  await awaitWindowRoom(3600,10000)
  for(let index=0;index<3;index++)await session(one,'198.51.100.7')
  const before=await contacts(),limited=await session(one,'198.51.100.7',null)
  const {retryAfter}=await expectLimited(limited,'widgetSessionsPerIpHour');assert.ok(retryAfter<=3600)
  assert.equal(limited.headers.get('Access-Control-Allow-Origin'),one.origin,'the widget can read the rejection cross-origin')
  assert.match(limited.headers.get('Access-Control-Expose-Headers')||'',/Retry-After/)
  assert.equal(await contacts(),before,'a refused session creates no contact')
  await session(one,'198.51.100.8');await session(two,'198.51.100.7')
  // IPv6 clients share one bucket per /64.
  for(const address of ['2001:db8:1:2::5','2001:db8:1:2:ffff::9','2001:0db8:0001:0002:0:0:0:77'])await session(one,address)
  await expectLimited(await session(one,'2001:db8:1:2:abcd::1',null),'widgetSessionsPerIpHour')
  await session(one,'2001:db8:1:3::1')

  // Conversations per contact and per project + address.
  await awaitWindowRoom(3600,10000)
  const visitor=async(project,ip)=>(await(await session(project,ip)).json()).token
  const start=(project,token,ip)=>call('/api/conversations',{body:{projectId:project.id},token,ip,origin:project.origin})
  const a=await visitor(one,'203.0.113.1')
  const conversations=[]
  for(let index=0;index<2;index++){const response=await start(one,a,'203.0.113.1');assert.equal(response.status,201);conversations.push((await response.json()).id)}
  await expectLimited(await start(one,a,'203.0.113.1'),'conversationsPerContactHour')
  const b=await visitor(one,'203.0.113.2'),c=await visitor(one,'203.0.113.2')
  for(const token of [b,b,c])assert.equal((await start(one,token,'203.0.113.2')).status,201)
  await expectLimited(await start(one,c,'203.0.113.2'),'conversationsPerIpHour')
  const otherTenant=await visitor(two,'203.0.113.2');assert.equal((await start(two,otherTenant,'203.0.113.2')).status,201,'another project from the same address is unaffected')

  // Messages per conversation (minute) and per contact (hour); refused messages are not admitted.
  await awaitWindowRoom(60,5000)
  const send=(conversation,token,localId,expectedRevision)=>call(`/api/conversations/${conversation}/messages`,{body:{localId,content:'Hello '+localId,expectedRevision},token,ip:'203.0.113.1',origin:one.origin})
  for(let index=0;index<3;index++){const response=await send(conversations[0],a,'first-'+index,index);assert.equal(response.status,200,await response.clone().text())}
  await expectLimited(await send(conversations[0],a,'first-3',3),'messagesPerConversationMinute')
  assert.equal((await db.prepare('SELECT revision FROM conversations WHERE id=?').bind(conversations[0]).first()).revision,3,'the refused message was not persisted')
  for(let index=0;index<2;index++)assert.equal((await send(conversations[1],a,'second-'+index,index)).status,200)
  await expectLimited(await send(conversations[1],a,'second-2',2),'messagesPerContactHour')
  const bConversation=(await db.prepare('SELECT id FROM conversations WHERE contact_id=(SELECT contact_id FROM sessions WHERE token_hash=?) LIMIT 1').bind(sha(b)).first()).id
  assert.equal((await send(bConversation,b,'other-contact',0)).status,200,'another contact is unaffected')

  // Uploads: daily count and daily bytes per contact; nothing is stored for a refusal.
  await awaitWindowRoom(86400,10000)
  const upload=(conversation,token,size)=>call(`/api/conversations/${conversation}/media`,{body:new Uint8Array(size).fill(7),token,ip:'203.0.113.3',origin:one.origin,headers:{'Content-Type':'application/octet-stream','X-Filename':'note.txt'}})
  const d=await visitor(one,'203.0.113.3'),dConversation=(await(await start(one,d,'203.0.113.3')).json()).id
  for(let index=0;index<2;index++)assert.equal((await upload(dConversation,d,300)).status,201)
  await expectLimited(await upload(dConversation,d,300),'uploadsPerContactDay')
  const e=await visitor(one,'203.0.113.3'),eConversation=(await(await start(one,e,'203.0.113.3')).json()).id
  assert.equal((await upload(eConversation,e,600)).status,201)
  await expectLimited(await upload(eConversation,e,600),'uploadBytesPerContactDay')
  assert.equal((await db.prepare('SELECT count(*) n FROM media').first()).n,3)
  assert.equal((await (await app.files).list()).objects.length,3)

  // Widget commands per contact.
  await awaitWindowRoom(60,5000)
  const event=()=>call(`/api/conversations/${dConversation}/widget-events`,{body:{action:'markAsRead'},token:d,ip:'203.0.113.3',origin:one.origin})
  for(let index=0;index<4;index++)assert.equal((await event()).status,200)
  await expectLimited(await event(),'widgetEventsPerContactMinute')

  // Project creation: per account and per address, including registration verification.
  await awaitWindowRoom(86400,10000)
  const create=(token,ip,name)=>call('/api/management/projects',{body:{name,allowedOrigin:'https://created.example'},token,ip})
  for(let index=0;index<2;index++)assert.equal((await create(one.ownerToken,'192.0.2.10','Created '+index)).status,201)
  await expectLimited(await create(one.ownerToken,'192.0.2.10','Created 2'),'projectsPerAccountDay')
  assert.equal((await create(two.ownerToken,'192.0.2.10','Other account')).status,201)
  await expectLimited(await create(two.ownerToken,'192.0.2.10','Other account 2'),'projectsPerIpDay')
  assert.equal((await create(two.ownerToken,'192.0.2.11','Other address')).status,201)
  for(let index=0;index<3;index++)assert.equal((await call('/api/identity/verify-email',{body:{token:'not-a-token-'+index},ip:'192.0.2.20'})).status,400)
  await expectLimited(await call('/api/identity/verify-email',{body:{token:'not-a-token-3'},ip:'192.0.2.20'}),'projectsPerIpDay')

  // Registration sends email and would create a project on installation keys: bounded per address.
  await awaitWindowRoom(86400,10000)
  const register=(index,ip)=>call('/api/identity/register',{body:{email:`new-${index}@example.com`,name:'New',projectName:'New '+index,allowedOrigin:'https://new.example',password:'synthetic-registration-fixture-password'},ip})
  for(let index=0;index<2;index++){const response=await register(index,'192.0.2.30');assert.equal(response.status,202,await response.clone().text())}
  await expectLimited(await register(2,'192.0.2.30'),'registrationsPerIpDay')
  assert.equal(outbound.filter(url=>url==='https://api.resend.com/emails').length,2,'no email is sent for a refused registration')
  assert.equal((await register(3,'192.0.2.31')).status,202)
  assert.deepEqual([...new Set(outbound)],['https://api.resend.com/emails'])

  // Stored keys are hashes; raw client addresses are never persisted.
  const keys=(await db.prepare('SELECT key FROM abuse_counters').all()).results.map(row=>row.key).join('\n')
  assert.doesNotMatch(keys,/198\.51|203\.0|2001:db8|192\.0/)
 }finally{await app.close()}
}

// Per-project ceilings bound rotating addresses, return refused capacity and stay per tenant.
export async function projectCeilings(){
 const {app,db,call}=await start({RATE_LIMITS:JSON.stringify({widgetSessionsPerProjectHour:5,conversationsPerProjectHour:4,uploadsPerProjectDay:4,uploadBytesPerProjectDay:1500})})
 try{
  const one=await seedProject(db,'rotate-one'),two=await seedProject(db,'rotate-two')
  const count=async table=>(await db.prepare(`SELECT count(*) n FROM ${table}`).first()).n
  const stored=async(limit,subject)=>(await db.prepare('SELECT used FROM abuse_counters WHERE key=?').bind(`rate:${limit}:${sha(subject)}`).first())?.used??0
  let address=0;const nextIp=()=>`198.18.${Math.floor(++address/250)}.${address%250+1}`
  const session=(project,ip=nextIp())=>call('/api/identity/widget/session',{body:{widgetKey:project.widgetKey},ip,origin:project.origin})

  // Sessions (and the contacts they create): every request from a new address, so no per-address limit applies.
  await awaitWindowRoom(3600,15000)
  const visitors=[]
  for(let index=0;index<5;index++){const response=await session(one);assert.equal(response.status,201,await response.clone().text());visitors.push(await response.json())}
  const contactsBefore=await count('contacts'),refusedIp=nextIp()
  const {retryAfter}=await expectLimited(await session(one,refusedIp),'widgetSessionsPerProjectHour');assert.ok(retryAfter<=3600)
  assert.equal(await count('contacts'),contactsBefore,'a refused session creates no contact')
  assert.equal(await stored('widgetSessionsPerIpHour',`${one.id}|${refusedIp}`),0,'the per-address capacity taken before the refusal is returned')
  const limited=await session(one);assert.equal(limited.status,429);assert.equal(limited.headers.get('Access-Control-Allow-Origin'),one.origin);assert.match(limited.headers.get('Access-Control-Expose-Headers')||'',/Retry-After/)
  const otherVisitors=[]
  for(let index=0;index<5;index++){const response=await session(two);assert.equal(response.status,201,'another project keeps its own session ceiling');otherVisitors.push(await response.json())}

  // Conversations: distinct visitors on distinct addresses share the project's ceiling.
  const start=(project,visitor,ip=nextIp())=>call('/api/conversations',{body:{projectId:project.id},token:visitor.token,ip,origin:project.origin})
  const conversations=[]
  for(const visitor of visitors.slice(0,4)){const response=await start(one,visitor);assert.equal(response.status,201,await response.clone().text());conversations.push({visitor,id:(await response.json()).id})}
  const conversationsBefore=await count('conversations')
  await expectLimited(await start(one,visitors[4]),'conversationsPerProjectHour')
  assert.equal(await count('conversations'),conversationsBefore,'a refused conversation is not created')
  assert.equal(await stored('conversationsPerContactHour',visitors[4].contactId),0,'the per-visitor capacity is returned')
  const otherConversation=await start(two,otherVisitors[0]);assert.equal(otherConversation.status,201,'another project keeps its own conversation ceiling')

  // Uploads: daily count and bytes per project, across visitors and addresses; nothing is stored for a refusal.
  await awaitWindowRoom(86400,10000)
  const upload=(project,{visitor,id},size)=>call(`/api/conversations/${id}/media`,{body:new Uint8Array(size).fill(5),token:visitor.token,ip:nextIp(),origin:project.origin,headers:{'Content-Type':'application/octet-stream','X-Filename':'note.txt'}})
  for(const [index,size] of [500,500,400].entries())assert.equal((await upload(one,conversations[index],size)).status,201)
  await expectLimited(await upload(one,conversations[3],200),'uploadBytesPerProjectDay')
  assert.equal(await stored('uploadsPerProjectDay',one.id),3,'the refused upload returned its count')
  assert.equal(await stored('uploadsPerContactDay',conversations[3].visitor.contactId),0)
  assert.equal((await upload(one,conversations[3],100)).status,201,'capacity returned by the refusal is usable')
  await expectLimited(await upload(one,conversations[0],1),'uploadsPerProjectDay')
  assert.equal(await stored('uploadBytesPerProjectDay',one.id),1500)
  assert.equal(await count('media'),4);assert.equal((await (await app.files).list()).objects.length,4)
  assert.equal((await upload(two,{visitor:otherVisitors[0],id:(await otherConversation.json()).id},1000)).status,201,'another project keeps its own upload ceiling')
 }finally{await app.close()}
}

// Daily AI ceilings: replies skipped visibly to operators only, the message kept, never replayed.
export async function aiCeilings(){
 const {app,db,call}=await start({OPENAI_API_KEY:'test-only-openai-key',AI_DAILY_CEILINGS:JSON.stringify({repliesPerProject:2,repliesPerInstallation:4,spendUsdPerProject:0.05})})
 try{
  const [alpha,beta,gamma]=await Promise.all(['alpha','beta','gamma'].map(id=>seedProject(db,id,{ai:true})))
  const open=async project=>{const visitor=await(await call('/api/identity/widget/session',{body:{widgetKey:project.widgetKey},ip:'198.51.100.50',origin:project.origin})).json();const conversation=await(await call('/api/conversations',{body:{projectId:project.id},token:visitor.token,ip:'198.51.100.50',origin:project.origin})).json();return {project,token:visitor.token,conversation:conversation.id,revision:0}}
  const say=async(chat,text)=>{const response=await call(`/api/conversations/${chat.conversation}/messages`,{body:{localId:text,content:text,expectedRevision:chat.revision},token:chat.token,ip:'198.51.100.50',origin:chat.project.origin});const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.accepted,true);assert.equal(body.generationError,undefined);assert.doesNotMatch(JSON.stringify(body),operatorOnly,'the message response carries no ceiling reason');chat.revision++;const generation=await db.prepare('SELECT * FROM ai_generations WHERE id=?').bind('reply:'+body.message.id).first();assert.ok(generation,'every visitor message has a recorded reply decision');return {message:body.message,generation}}
  const usage=async project=>(await(await call(`/api/dashboard/projects/${project.id}/ai-usage`,{token:project.ownerToken})).json()).data
  // Every ceiling below is a daily count; the whole test must fall inside one UTC day.
  await awaitWindowRoom(86400,60000)

  // Spend: provider-reported cost of automatic replies accumulates once per provider round.
  const g=await open(gamma),first=await say(g,'gamma one');assert.equal(first.generation.state,'queued')
  // The first reply runs; the spend is exactly the cost of its recorded provider rounds.
  await app.runJobs((await app.takeJobs()).filter(job=>job.id===first.generation.id))
  const rounds=(await db.prepare('SELECT u.usage_json FROM ai_round_usage u JOIN ai_attempts t ON t.id=u.attempt_id WHERE t.generation_id=?').bind(first.generation.id).all()).results
  const spent=rounds.reduce((sum,row)=>sum+JSON.parse(row.usage_json).cost,0);assert.ok(spent>0.05)
  assert.equal((await usage(gamma)).spendUsd.used,Math.round(spent*1e6)/1e6,'provider-reported usage is the spend')
  g.revision=(await db.prepare('SELECT revision FROM conversations WHERE id=?').bind(g.conversation).first()).revision
  const overSpend=await say(g,'gamma two');assert.equal(overSpend.generation.state,'failed');assert.match(overSpend.generation.error,/^AI_REPLY_CEILING: .*spendUsdPerProject/)
  // An explicit reply request over the spend ceiling is refused; the spend stays operator-only.
  const spendRefusal=await expectAiRefused(()=>call(`/api/conversations/${g.conversation}/widget-events`,{body:{action:'request',data:{requestId:'00000000-0000-4000-8000-0000000000c1'}},token:g.token,ip:'198.51.100.50',origin:gamma.origin}),gamma.origin)
  assert.doesNotMatch(JSON.stringify(spendRefusal),/0\.12|0\.05/)
  assert.match((await db.prepare('SELECT error FROM ai_generations WHERE id=?').bind('00000000-0000-4000-8000-0000000000c1').first()).error,/^AI_REPLY_CEILING: .*\(\$0\.12\).*spendUsdPerProject/,'operators still see the spend reason')

  // Per-project reply count: the third automatic reply is skipped; the message itself persists.
  const a=await open(alpha)
  // Everything the visitor's live socket receives is checked for operator-only ceiling text.
  const socketResponse=await app.request(`/api/conversations/${a.conversation}/socket?token=${a.token}`,{headers:{Upgrade:'websocket',Origin:alpha.origin}});assert.equal(socketResponse.status,101)
  const frames=[];socketResponse.webSocket.accept();socketResponse.webSocket.addEventListener('message',event=>frames.push(String(event.data)))
  for(const text of ['alpha one','alpha two'])assert.equal((await say(a,text)).generation.state,'queued')
  const skipped=await say(a,'alpha three')
  assert.equal(skipped.generation.state,'failed');assert.match(skipped.generation.error,/^AI_REPLY_CEILING: .*repliesPerProject/)
  assert.equal((await db.prepare('SELECT content FROM messages WHERE id=?').bind(skipped.message.id).first()).content,'alpha three')
  assert.equal((await db.prepare("SELECT count(*) n FROM ai_attempts WHERE generation_id=?").bind(skipped.generation.id).first()).n,0)

  // No replay later: scheduler-style effect replay and a duplicate command reuse the recorded decision.
  for(let index=0;index<2;index++)await app.scheduled()
  const duplicate=await(await call(`/api/conversations/${a.conversation}/messages`,{body:{localId:'alpha three',content:'alpha three',expectedRevision:2},token:a.token,ip:'198.51.100.50',origin:alpha.origin})).json();assert.equal(duplicate.duplicate,true)
  const decisions=(await db.prepare("SELECT id,state FROM ai_generations WHERE conversation_id=? ORDER BY created_at").bind(a.conversation).all()).results
  assert.deepEqual(decisions.map(row=>row.state),['queued','queued','failed'])
  // A visitor's explicit reply request is under the same ceiling: 429 with Retry-After until 00:00 UTC.
  const request=()=>call(`/api/conversations/${a.conversation}/widget-events`,{body:{action:'request',data:{requestId:'00000000-0000-4000-8000-0000000000a1'}},token:a.token,ip:'198.51.100.50',origin:alpha.origin})
  await expectAiRefused(request,alpha.origin)
  const recorded=await db.prepare('SELECT state,error FROM ai_generations WHERE id=?').bind('00000000-0000-4000-8000-0000000000a1').first()
  assert.equal(recorded.state,'failed');assert.match(recorded.error,/^AI_REPLY_CEILING: .*repliesPerProject/,'operators keep the reason on the generation')
  // Repeating the same command the same day is refused again; it is never queued or counted twice.
  await expectAiRefused(request,alpha.origin)
  assert.equal((await db.prepare('SELECT count(*) n FROM ai_generations WHERE id=?').bind('00000000-0000-4000-8000-0000000000a1').first()).n,1)

  // Operators see the skip in the conversation transcript and in today's usage.
  const buckets=await(await call(`/api/dashboard/projects/${alpha.id}/conversations/${a.conversation}/buckets`,{token:alpha.ownerToken})).json()
  const events=buckets.data.flatMap(bucket=>bucket.events).filter(event=>event.type==='AI_REPLY_SKIPPED')
  assert.equal(events.length,2);assert.match(events[0].payload.reason,/^Automatic AI replies are paused until 00:00 UTC.*daily ceiling of 2 automatic replies/)
  const alphaUsage=await usage(alpha)
  assert.deepEqual({replies:alphaUsage.replies,skipped:alphaUsage.skippedReplies,reached:alphaUsage.replyCeilingReached},{replies:{used:2,limit:2},skipped:2,reached:true})
  assert.match(alphaUsage.resetsAt,/T00:00:00.000Z$/)
  const foreign=await call(`/api/dashboard/projects/${alpha.id}/ai-usage`,{token:beta.ownerToken});assert.equal(foreign.status,403,'usage is visible to project members only')
  const visitorView=await(await call(`/api/conversations/${a.conversation}/messages`,{token:a.token,origin:alpha.origin})).json()
  assert.ok(!JSON.stringify(visitorView).includes('AI_REPLY_CEILING'),'the reason is operator-only')
  for(const path of [`/api/conversations/${a.conversation}/messages`,'/api/conversations']){const response=await call(path,{token:a.token,origin:alpha.origin});assert.equal(response.status,200);assert.doesNotMatch(await response.text(),/AI_REPLY_CEILING|repliesPerProject|spend/i,path)}
  // Generation state, generation requests and usage are operator routes: a visitor session is refused without detail.
  for(const [path,body] of [[`/api/ai-support/projects/${alpha.id}/generations/00000000-0000-4000-8000-0000000000a1`],[`/api/ai-support/projects/${alpha.id}/conversations/${a.conversation}/generations`,{expectedRevision:a.revision}],[`/api/dashboard/projects/${alpha.id}/ai-usage`]]){
   const response=await call(path,{body,token:a.token,origin:alpha.origin});assert.equal(response.status,403,path);assert.doesNotMatch(await response.text(),operatorOnly,path)
  }
  await new Promise(resolve=>setTimeout(resolve,200))
  assert.ok(frames.length>=3,'the visitor socket delivered the transcript');for(const frame of frames)assert.doesNotMatch(frame,/AI_REPLY_CEILING|repliesPerProject|spend/i)
  socketResponse.webSocket.close()

  // Tenant isolation: another project still gets replies until the installation ceiling.
  const b=await open(beta)
  assert.equal((await say(b,'beta one')).generation.state,'queued')
  const installation=await say(b,'beta two');assert.equal(installation.generation.state,'failed');assert.match(installation.generation.error,/repliesPerInstallation/)
  const betaUsage=await usage(beta);assert.equal(betaUsage.replies.used,1);assert.equal(betaUsage.installationCeilingReached,true);assert.equal(betaUsage.replyCeilingReached,true)
  await expectAiRefused(()=>call(`/api/conversations/${b.conversation}/widget-events`,{body:{action:'request',data:{requestId:'00000000-0000-4000-8000-0000000000b1'}},token:b.token,ip:'198.51.100.50',origin:beta.origin}),beta.origin)
  assert.equal((await db.prepare("SELECT count(*) n FROM ai_generations WHERE state IN ('queued','completed')").first()).n,4,'exactly the installation ceiling was admitted')
 }finally{await app.close()}
}

// Reply request ids are UUIDs, so no free text becomes a generation id that erasure keeps.
export async function requestIds(){
 const {app,db,call}=await start({OPENAI_API_KEY:'test-only-openai-key'})
 try{
  const project=await seedProject(db,'delta',{ai:true}),ip='198.51.100.60',origin=project.origin
  const visitor=await(await call('/api/identity/widget/session',{body:{widgetKey:project.widgetKey},ip,origin})).json()
  const conversation=await(await call('/api/conversations',{body:{projectId:project.id},token:visitor.token,ip,origin})).json()
  const widgetRequest=requestId=>call(`/api/conversations/${conversation.id}/widget-events`,{body:{action:'request',data:{requestId}},token:visitor.token,ip,origin})
  // The AI reply's `generation:<id>` local id survives contact erasure, so free text must never become that id.
  const marker='Alice Smith card 4242'
  const refused=await widgetRequest(marker);assert.equal(refused.status,400,await refused.clone().text())
  const operator=await call(`/api/dashboard/projects/${project.id}/conversations/${conversation.id}/actions`,{body:{action:'request',data:{requestId:'operator '+marker}},token:project.ownerToken})
  assert.equal(operator.status,400,await operator.clone().text())
  const tables=(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").all()).results.map(row=>row.name)
  assert.ok(tables.includes('ai_generations')&&tables.includes('messages'))
  for(const table of tables)assert.ok(!JSON.stringify((await db.prepare(`SELECT * FROM "${table}"`).all()).results).includes(marker),`${table} holds no refused request id`)
  // A UUID stays the generation id, so a widget retry is still the same command.
  const id='00000000-0000-4000-8000-0000000000d1'
  for(let attempt=0;attempt<2;attempt++){const accepted=await widgetRequest(id);const body=await accepted.json();assert.equal(accepted.status,202,JSON.stringify(body));assert.deepEqual(body,{id,state:'queued'})}
  assert.equal((await db.prepare('SELECT count(*) n FROM ai_generations').first()).n,1)
 }finally{await app.close()}
}

// An invalid limit fails visibly instead of silently removing the limit.
export async function invalidLimits(){
 const {app,db,call}=await start({RATE_LIMITS:JSON.stringify({widgetSessionsPerIpHour:0})})
 try{
  const project=await seedProject(db,'config')
  const response=await call('/api/identity/widget/session',{body:{widgetKey:project.widgetKey},ip:'198.51.100.60',origin:project.origin})
  assert.equal(response.status,500)
  assert.equal((await db.prepare('SELECT count(*) n FROM contacts').first()).n,0)
 }finally{await app.close()}
}

// The documented usage summary command keeps unmeasured D1 metadata and billing unknown, never zero.
export async function usageSummary(){
 const {execFile}=await import('node:child_process'),{promisify}=await import('node:util')
 const fixture=new URL('../../fixtures/usage/local-workload.json',import.meta.url).pathname,raw=JSON.parse(await (await import('node:fs/promises')).readFile(fixture,'utf8'))
 const result=JSON.parse((await promisify(execFile)(process.execPath,['scripts/usage/summarize.mjs',fixture])).stdout)
 for(const name of ['new_visitor','returning_visitor']){
  const phase=result.phases[name];assert.equal(phase.d1.rows_read,null);assert.equal(phase.d1.rows_written,null);assert.ok(phase.d1.missing_metadata_statements>0)
  assert.equal(phase.r2.uploaded_bytes,raw.phases?.[name]?.r2?.uploaded_bytes??phase.r2.uploaded_bytes);assert.equal(phase.queue_messages,0)
 }
 assert.ok(result.scenarios.every(scenario=>scenario.billing_total_usd===null&&scenario.d1_total_rows_read===null),'unmeasured billing is never reported as a number')
}
