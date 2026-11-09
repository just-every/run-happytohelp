import assert from 'node:assert/strict'
import {randomUUID,webcrypto} from 'node:crypto'
import {startApp} from '../../journeys/kit/app.mjs'
import {autonomousPolicy,policyEnvelope,seconds,signJws} from '../../../src/vendor/agent-base/modules/agent-door/conformance/crypto.mjs'

export async function relayStopJourney(){
 const pair=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify'])
 const kid=randomUUID(),issuer='https://business.example.test',installationId=randomUUID(),origin='https://app.example',email='morgan@example.test',sub=randomUUID(),setupToken=randomUUID()
 const publicKeys={[kid]:await webcrypto.subtle.exportKey('jwk',pair.publicKey)}
 const app=await startApp({bindings:{APP_ORIGIN:origin,H2H_SETUP_TOKEN:setupToken,H2H_SETUP_OWNER_EMAIL:email,RER_INSTALLATION_ID:installationId,RER_OWNER_CLAIM_ISSUER:issuer,RER_OWNER_CLAIM_INSTALLATION_ID:installationId,RER_OWNER_CLAIM_APP_ORIGIN:origin,RER_OWNER_CLAIM_PUBLIC_KEYS:JSON.stringify(publicKeys),RER_BUSINESS_TRUST:JSON.stringify({v:1,issuer,audience:origin,subject:installationId,email,keys:publicKeys})}})
 try{
  const owner=await app.ok('/api/identity/bootstrap',{body:{setupToken,email,password:'Disposable-native-owner-892!zz',allowedOrigin:'https://store.example.test',ownerName:'Morgan Support'}})
  const context={origin,signer:{issuer,installationId,kid,privateKey:pair.privateKey},business:'support-company',revision:0,seq:0}
  const settings=async(rev,detached=false)=>{
   const iat=seconds(),settings=await signJws(pair.privateKey,kid,'rer-business-settings+jwt',{v:1,iss:issuer,aud:origin,sub:installationId,business:context.business,email,owner_id:sub,jti:randomUUID(),iat,exp:iat+300,rev,values:{},logo:null,team:null,...(detached?{detached:true}:{})})
   const response=await app.call('/api/rer/business-settings',{body:{settings}})
   assert.equal(response.status,200,JSON.stringify(response.data))
  }
  const envelope=await policyEnvelope(context,autonomousPolicy())
  assert.equal((await app.call('/api/rer/agent-policy',{body:{policy:envelope.policy}})).status,200)
  const pull=async()=>{
   const iat=seconds(),signed=await signJws(pair.privateKey,kid,'rer-agent-decisions+jwt',{v:1,iss:issuer,aud:origin,sub:installationId,business:context.business,after:0,limit:200,iat,exp:iat+60,jti:randomUUID()})
   return app.call('/api/rer/agent-decisions',{body:{pull:signed}})
  }
  assert.equal((await pull()).status,404,'a paired policy alone cannot prove that Business admission is running')
  await settings(1)
  const running=await pull()
  assert.equal(running.status,200,JSON.stringify(running.data))
  assert.deepEqual(running.data.decisions,[],'the real signed pull can read the empty Business feed')
  // A lost durable row must not turn a formerly paired Business back on.
  const state=await app.first('SELECT * FROM bs_settings WHERE singleton=1')
  await app.db.prepare('DELETE FROM bs_settings WHERE singleton=1').run()
  assert.equal((await pull()).status,404)
  const columns=Object.keys(state)
  await app.db.prepare(`INSERT INTO bs_settings(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).bind(...Object.values(state)).run()
  assert.equal((await pull()).status,200)
  await settings(2,true)
  assert.equal((await pull()).status,404,'signed detachment durably stops relay access')
  await app.configure({})
  assert.equal((await pull()).status,404,'the stop survives a Worker restart')
  assert.equal((await app.call('/api/identity/session',{token:owner.token})).status,200)
 }finally{await app.close()}
}
