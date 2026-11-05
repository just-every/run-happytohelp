import assert from 'node:assert/strict'
import {randomUUID,webcrypto} from 'node:crypto'
import {startApp} from '../../journeys/kit/app.mjs'
import {signJws,seconds} from '../../../src/vendor/agent-base/modules/agent-door/conformance/crypto.mjs'

/** The signed read uses the real router, native claim and committed widget messages. */
export async function cutoverStatusJourney(){
 const pair=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify'])
 const kid=randomUUID(),issuer='https://business.example.test',installationId=randomUUID(),origin='https://app.example',email='synthetic-happytohelp-1@example.test'
 const trust={RER_INSTALLATION_ID:installationId,RER_OWNER_CLAIM_ISSUER:issuer,RER_OWNER_CLAIM_INSTALLATION_ID:installationId,RER_OWNER_CLAIM_APP_ORIGIN:origin,RER_OWNER_CLAIM_PUBLIC_KEYS:JSON.stringify({[kid]:await webcrypto.subtle.exportKey('jwk',pair.publicKey)})}
 const app=await startApp({captureQueue:true,bindings:{APP_ORIGIN:origin,H2H_SETUP_TOKEN:'synthetic-happytohelp-1',H2H_SETUP_OWNER_EMAIL:email,...trust}})
 try{
  const owner=await app.ok('/api/identity/bootstrap',{body:{setupToken:'synthetic-happytohelp-1',email,password:'Synthetic-happytohelp-1-password!',allowedOrigin:origin}})
  const other=await app.seedWorkspace('synthetic-happytohelp-2',{allowedOrigin:origin})
  const path='/api/rer/cutover-status',since=new Date(Date.now()-1).toISOString()
  const grant=async(overrides={},key=pair.privateKey)=>{const now=seconds();return signJws(key,kid,'rer-import-grant+jwt',{v:1,iss:issuer,aud:origin,installationId,email,jti:randomUUID(),iat:now,exp:now+120,action:'cutover-status',...(typeof overrides==='function'?overrides(now):overrides)})}
  const token=await grant(),read=(body={since},credential=token,options={})=>app.call(path,{body,token:credential,...options})
  const tables=await app.sql("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_cf_%' ORDER BY name")
  const inventory=async()=>(await app.db.batch(tables.map(({name})=>app.db.prepare(`SELECT count(*) n FROM "${name.replaceAll('"','""')}"`))))
   .map((row,i)=>({name:tables[i].name,n:row.results[0].n}))
  const pureRead=async(body={since},credential=token,options={})=>{
   const before=await inventory(),result=await read(body,credential,options)
   assert.deepEqual(await inventory(),before,'the read/refusal changes no table record count')
   assert.equal(result.headers.get('Cache-Control'),'no-store')
   return result
  }
  const empty=await pureRead();assert.equal(empty.status,200)
  assert.deepEqual(empty.data,{created_since:{conversations:0,messages:0},events_since:0,last_event_at:null})
  // Even a real widget session and an empty conversation are not message events.
  const visitor=async(projectId,ownerToken)=>{
   await app.presenceAwayOff(projectId)
   const project=await app.ok(`/api/identity/projects/${projectId}`,{token:ownerToken})
   const session=await app.ok('/api/identity/widget/session',{body:{widgetKey:project.widget_key},headers:{Origin:origin}})
   const conversation=await app.ok('/api/conversations',{body:{projectId},token:session.token})
   return {conversation,session}
  }
  const own=await visitor(owner.projectId,owner.token),foreign=await visitor(other.projectId,other.tokens.owner)
  const messagePath=value=>`/api/conversations/${value.conversation.id}/messages`
  await app.ok(messagePath(foreign),{token:foreign.session.token,body:{localId:'synthetic-happytohelp-2',content:'Foreign private activity',expectedRevision:0}})
  const beforeMessage=await pureRead();assert.equal(beforeMessage.data.events_since,0)
  assert.deepEqual(beforeMessage.data.created_since,{conversations:1,messages:0},'the other workspace is excluded')
  const command={localId:'synthetic-happytohelp-1',content:'Synthetic visitor needs support',expectedRevision:0}
  const accepted=await app.ok(messagePath(own),{token:own.session.token,body:command})
  assert.equal(accepted.accepted,true)
  assert.equal((await app.ok(messagePath(own),{token:own.session.token,body:command})).duplicate,true)
  const event=await app.first('SELECT created_at FROM conversation_outbox WHERE message_id=?',accepted.message.id)
  const after=await pureRead();assert.equal(after.status,200)
  assert.deepEqual(after.data,{created_since:{conversations:1,messages:1},events_since:1,last_event_at:new Date(event.created_at).toISOString()})
  assert.deepEqual((await pureRead()).data,after.data,'a read grant can be repeated without a nonce write')
  const boundary=await pureRead({since:new Date(event.created_at).toISOString()})
  assert.deepEqual(boundary.data.created_since,{conversations:0,messages:0});assert.equal(boundary.data.events_since,0,'since is exclusive')
  assert.equal((await pureRead({since:new Date(event.created_at+60_000).toISOString()})).data.events_since,0)
  // No body, customer identity, destination selector or content is returned.
  for(const secret of [owner.projectId,own.conversation.id,own.session.contactId,foreign.conversation.id,command.content,email].filter(Boolean))assert.ok(!JSON.stringify(after.data).includes(secret))
  assert.equal((await pureRead({since},'')).status,401)
  assert.equal((await pureRead({since},owner.token)).status,403,'native sessions are not RER read grants')
  for(const overrides of [{iss:'https://foreign.example.test'},{aud:'https://foreign.example.test'},{installationId:'foreign-installation'},{email:'foreign@example.test'},{action:'runner-status'},{action:'status'},now=>({iat:now-120,exp:now-1}),now=>({iat:now+120,exp:now+240}),now=>({iat:now,exp:now+301}),{jti:'not-a-nonce'},{namespace:'zendesk',maxBytes:100,maxChunks:1,maxRecords:1}]){
   const refused=await pureRead({since},await grant(overrides));assert.equal(refused.status,403,JSON.stringify(overrides));assert.deepEqual(refused.data,{error:'invalid_grant'})
  }
  const untrusted=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify'])
  assert.equal((await pureRead({since},await grant({},untrusted.privateKey))).status,403)
  assert.equal((await pureRead({since},token,{base:'https://foreign.example.test'})).status,403,'request origin is bound independently')
  for(const body of [null,[],{}, {since:null},{since:0},{since:'yesterday'},{since:'2026-11-05'},{since,projectId:other.projectId}])assert.equal((await pureRead(body)).status,400,JSON.stringify(body))
  assert.equal((await app.call(path,{method:'GET'})).status,405)
  await app.configure({RER_OWNER_CLAIM_PUBLIC_KEYS:undefined})
  assert.equal((await pureRead()).status,503,'incomplete trust cannot disclose aggregates')
  await app.configure({...trust,RER_MANAGEMENT_ORIGIN:'https://foreign.example.test'})
  assert.equal((await pureRead()).status,503,'conflicting issuer cannot disclose aggregates')
  await app.configure({...trust,RER_MANAGEMENT_ORIGIN:undefined})
  await app.db.prepare("UPDATE project_settings SET settings_json=json_set(settings_json,'$.suspended_at',?) WHERE project_id=?").bind(Date.now(),owner.projectId).run()
  assert.equal((await pureRead()).status,409,'a suspended linked workspace cannot be read')
  assert.equal(app.requests.length,0,'the read and widget probes make no provider requests')
  console.log('CUTOVER PROBE: public widget message events_since 0 -> 1; conversations/messages 1/1; foreign workspace excluded; exclusive since; exact replay; all table counts unchanged by reads/refusals; trust, signature, issuer, audience, installation, owner, action, expiry, body and suspended workspace refused; no provider calls')
 }finally{await app.close()}
}
