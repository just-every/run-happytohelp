import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {randomBytes,randomUUID,webcrypto} from 'node:crypto'
import {startApp,applyMigrations} from '../../journeys/kit/app.mjs'
import {accessToken,autonomousPolicy,policyEnvelope,seconds,signJws} from '../../../src/vendor/agent-base/modules/agent-door/conformance/crypto.mjs'

export async function legacyApprovalUpgradeJourney(){
 const pair=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify'])
 const kid=randomUUID(),issuer='https://business.example.test',installationId=randomUUID(),origin='https://app.example',email='morgan@example.test',sub=randomUUID(),setupToken=randomUUID()
 const publicKeys={[kid]:await webcrypto.subtle.exportKey('jwk',pair.publicKey)}
 const upgrade=name=>name==='317_agent_door_legacy_principals.sql'
 const app=await startApp({cf:{country:'US'},migrate:name=>!upgrade(name),bindings:{INTEGRATION_ENCRYPTION_KEY:randomBytes(32).toString('base64'),APP_ORIGIN:origin,H2H_SETUP_TOKEN:setupToken,H2H_SETUP_OWNER_EMAIL:email,RER_INSTALLATION_ID:installationId,RER_OWNER_CLAIM_ISSUER:issuer,RER_OWNER_CLAIM_INSTALLATION_ID:installationId,RER_OWNER_CLAIM_APP_ORIGIN:origin,RER_OWNER_CLAIM_PUBLIC_KEYS:JSON.stringify(publicKeys),RER_BUSINESS_TRUST:JSON.stringify({v:1,issuer,audience:origin,subject:installationId,email,keys:publicKeys})}})
 try{
  const owner=await app.ok('/api/identity/bootstrap',{body:{setupToken,email,password:'Disposable-native-owner-892!zz',allowedOrigin:'https://store.example.test',ownerName:'Morgan Support'}})
  const native=(path,options={})=>app.ok(path,{token:owner.token,...options})
  const person=(path,options={})=>app.ok(path,{...options,headers:{Cookie:'h2h_session='+owner.token,Origin:origin}})
  const context={origin,signer:{issuer,installationId,kid,privateKey:pair.privateKey},person:{email,sub},agentId:randomUUID(),business:'support-company',consent:randomUUID(),revision:0,seq:0,surface:JSON.parse(await readFile(new URL('../../../agent-surface.json',import.meta.url),'utf8'))}
  const settings=async(rev,detached=false)=>{
   const iat=seconds(),settings=await signJws(pair.privateKey,kid,'rer-business-settings+jwt',{v:1,iss:issuer,aud:origin,sub:installationId,business:context.business,email,owner_id:sub,jti:randomUUID(),iat,exp:iat+300,rev,values:{},logo:null,team:null,...(detached?{detached:true}:{})})
   assert.equal((await app.call('/api/rer/business-settings',{body:{settings}})).status,200)
  }
  await settings(1)
  const envelope=await policyEnvelope(context,{...autonomousPolicy(),rules:[{id:'held',class:'*',do:'approval',approver:['sponsor'],wait:'PT1H'}]})
  assert.equal((await app.call('/api/rer/agent-policy',{body:{policy:envelope.policy}})).status,200)
  const contact=(await native(`/api/management/projects/${owner.projectId}/contacts`,{body:{name:'Avery Buyer',email:'avery@example.test'}})).data
  const ticket=await native('/api/conversations',{body:{projectId:owner.projectId,contactId:contact.id}})
  const hold=async()=>{
   const response=await app.call('/mcp',{headers:{'Mcp-Method':'tools/call','Mcp-Name':'happytohelp.conversations.read',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2026-07-28',Authorization:'Bearer '+await accessToken(context)},body:{jsonrpc:'2.0',id:randomUUID(),method:'tools/call',params:{name:'happytohelp.conversations.read',arguments:{id:ticket.id},_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{elicitation:{url:{}}},'io.modelcontextprotocol/clientInfo':{name:'legacy-upgrade-journey',version:'1'}}}}})
   assert.equal(response.status,200,JSON.stringify(response.data))
   const id=response.data.result._meta['com.runeditrun/approval'].id
   const view=(await person('/agents/api/approvals/'+id)).approval
   return {id,view}
  }
  const legacy=await hold()
  const running=await hold()
  // Reconstruct pre-0.2.104 persisted principals from real public-door holds.
  // Business admission already saved consent, but did not yet save source.
  for(const held of [legacy,running])await app.db.prepare("UPDATE agent_door_approvals SET saved=json_remove(saved,'$.principal.source') WHERE id=?").bind(held.id).run()
  const saved=JSON.parse((await app.first('SELECT saved FROM agent_door_approvals WHERE id=?',legacy.id)).saved)
  assert.equal(Object.hasOwn(saved.principal,'source'),false)
  // Historical native/embedded and terminal snapshots must stay byte-identical.
  const controls=[
   ['local','pending',{...saved,principal:{...saved.principal,consent:undefined}}],
   ['embedded','pending',{...saved,door:'embedded'}],
   ['tagged-local','pending',{...saved,principal:{...saved.principal,source:'local'}}],
   ['tagged-business','pending',{...saved,principal:{...saved.principal,source:'business'}}],
   ['terminal','executed',saved],
   ['erased','pending',{tombstone:{kind:'person'},tool:saved.tool}],
  ]
  for(const [id,state,value] of controls)await app.db.prepare('INSERT INTO agent_door_approvals(id,state,saved) VALUES(?,?,?)').bind(id,state,JSON.stringify(value)).run()
  const before=await app.sql('SELECT * FROM agent_door_approvals ORDER BY id')
  const audit=await app.sql('SELECT * FROM agent_door_audit ORDER BY sequence')
  const migrate=()=>applyMigrations(app.db,upgrade)
  await migrate()
  const upgraded=await app.sql('SELECT * FROM agent_door_approvals ORDER BY id')
  for(const row of before){
   const after=upgraded.find(item=>item.id===row.id)
   if([legacy.id,running.id].includes(row.id)){
    const value=JSON.parse(row.saved);value.principal.source='business'
    assert.deepEqual(JSON.parse(after.saved),value,'only the admission source is added')
    assert.deepEqual({...after,saved:row.saved},row,'all other approval columns survive')
   }else assert.deepEqual(after,row,'unrelated approval bytes survive')
  }
  assert.deepEqual(await app.sql('SELECT * FROM agent_door_audit ORDER BY sequence'),audit,'audit bytes survive the upgrade')
  await migrate()
  assert.deepEqual(await app.sql('SELECT * FROM agent_door_approvals ORDER BY id'),upgraded,'the migration is idempotent')
  assert.deepEqual(await app.sql('SELECT * FROM agent_door_audit ORDER BY sequence'),audit)
  const approve=held=>person('/agents/api/approvals/'+held.id+'/approve',{body:{revision:held.view.revision,summary_sha256:held.view.summary_sha256},headers:{Origin:origin}})
  const allowed=await approve(running)
  assert.equal(allowed.approval.state,'executed',JSON.stringify(allowed))
  const fresh=await hold()
  assert.equal(JSON.parse((await app.first('SELECT saved FROM agent_door_approvals WHERE id=?',fresh.id)).saved).principal.source,'business')
  await settings(2,true)
  await app.configure({})
  const approved=await approve(legacy),newApproval=await approve(fresh)
  const result=async held=>JSON.parse((await app.first('SELECT result FROM agent_door_approvals WHERE id=?',held.id)).result)
  assert.equal((await result(running)).result.ticket.id,ticket.id)
  console.log(`PROBE legacy-upgrade: stopped legacy=${approved.approval.state}/${approved.approval.code}; running=${allowed.approval.state}; stopped new=${newApproval.approval.state}/${newApproval.approval.code}; transcript withheld; audit bytes preserved; migration idempotent`)
  for(const result of [approved,newApproval]){
   assert.equal(result.approval.state,'refused',JSON.stringify(result))
   assert.equal(result.approval.code,'sponsor_unavailable')
  }
  for(const held of [legacy,fresh])assert.equal((await result(held)).result,undefined,'stopped approvals expose no transcript')
 }finally{await app.close()}
}
