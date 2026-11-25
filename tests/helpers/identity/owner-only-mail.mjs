import assert from 'node:assert/strict'
import {startApp} from '../../journeys/kit/app.mjs'

// MAIL_RECIPIENTS=owner: the configured owner asks for a sign-in link on the public route and receives one
// single-use link; a teammate's or a stranger's address gets nothing behind the identical answer, and every
// other mail stays off. Only the provider's network edge is faked.
export async function ownerOnlyMailJourney(){
 const sent=[],owner='owner-own@example.test'
 const app=await startApp({bindings:{APP_ORIGIN:'https://app.example',MAIL_PROVIDER:'resend',EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'synthetic-owner-mail-key',EMAIL_FROM:'support@example.test',MAIL_RECIPIENTS:'owner',OWNER_EMAIL:owner},outbound:async request=>{
  assert.equal(new URL(request.url).origin,'https://api.resend.com')
  sent.push(await request.json())
  return Response.json({id:'synthetic-owner-mail-'+sent.length})
 }})
 try{
  const identity=(path,body,headers)=>app.call('/api/identity'+path,{body,headers})
  const workspace=await app.seedWorkspace('own')
  assert.equal((await app.call('/api/identity/sign-in-options')).data.mailMode,'remote')

  const teammate=await identity('/magic-link',{email:'operator-own@example.test'}),stranger=await identity('/magic-link',{email:'nobody@example.test'})
  const asked=await identity('/magic-link',{email:'Owner-Own@Example.test'})
  for(const answer of [teammate,stranger,asked])assert.equal(answer.status,202)
  assert.deepEqual(teammate.data,asked.data);assert.deepEqual(stranger.data,asked.data)
  await app.until(()=>sent.length>0)
  assert.equal(sent.length,1);assert.deepEqual(sent[0].to,[owner]);assert.equal(sent[0].cc,undefined);assert.equal(sent[0].bcc,undefined)

  const token=new URLSearchParams(new URL(sent[0].text.match(/https?:\/\/\S+/)[0]).hash.slice(1)).get('token')
  const entered=await identity('/magic-link/consume',{token})
  assert.equal(entered.status,200);assert.equal(entered.data.signedIn,true)
  const session=await app.call('/api/identity/session',{headers:{Cookie:entered.headers.get('set-cookie').split(';')[0]}})
  assert.equal(session.data.id,workspace.users.owner)
  assert.equal((await identity('/magic-link/consume',{token})).status,400)

  // Every other mail stays off, as with MAIL_PROVIDER=none.
  const reset=await identity('/forgot-password',{email:owner})
  assert.equal(reset.status,503);assert.match(reset.data.error,/Outbound email is off for this installation/)
  assert.equal(sent.length,1)
 }finally{await app.close()}
}
