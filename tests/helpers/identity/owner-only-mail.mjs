import assert from 'node:assert/strict'
import {startApp} from '../../journeys/kit/app.mjs'

// MAIL_RECIPIENTS=owner: the configured owner asks for a sign-in link on the public route and receives one
// single-use link; a teammate's or a stranger's address gets nothing behind the identical answer, and every
// other mail stays off. It holds for the owner's own provider and for the platform's owner-only relay
// (MAIL_PROVIDER=rer). Only the provider's or relay's network edge is faked.
const owner='owner-own@example.test'
const resend={
 bindings:{MAIL_PROVIDER:'resend',EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'synthetic-owner-mail-key',EMAIL_FROM:'support@example.test'},
 async answer(request,sent){
  assert.equal(new URL(request.url).origin,'https://api.resend.com')
  const message=await request.json();sent.push(message)
  assert.deepEqual(message.to,[owner]);assert.equal(message.cc,undefined);assert.equal(message.bcc,undefined)
  return Response.json({id:'synthetic-owner-mail-'+sent.length})
 },
}
// The relay's first answer is a redirect, which must not be followed and sends nothing; the next is accepted.
const relay={
 bindings:{MAIL_PROVIDER:'rer',MAIL_FROM:'noreply@platform.example',MAIL_RELAY_URL:'https://platform.example/api/managed-mail/send',MAIL_API_KEY:'synthetic-relay-key'},
 async answer(request,sent,calls){
  assert.equal(request.url,'https://platform.example/api/managed-mail/send')
  assert.equal(request.headers.get('authorization'),'Bearer synthetic-relay-key')
  const message=await request.json()
  assert.deepEqual(Object.keys(message).sort(),['subject','text','to']);assert.equal(message.to,owner)
  if(calls===1)return new Response(null,{status:307,headers:{Location:'https://elsewhere.example/collect'}})
  sent.push(message)
  return Response.json({accepted:true,messageId:'<synthetic-'+sent.length+'@platform.example>'},{status:202})
 },
}

async function ownerOnlyMail(provider){
 const sent=[];let calls=0
 const app=await startApp({bindings:{APP_ORIGIN:'https://app.example',MAIL_RECIPIENTS:'owner',OWNER_EMAIL:owner,...provider.bindings},outbound:request=>provider.answer(request,sent,++calls)})
 try{
  const identity=(path,body,headers)=>app.call('/api/identity'+path,{body,headers})
  const workspace=await app.seedWorkspace('own')
  assert.equal((await app.call('/api/identity/sign-in-options')).data.mailMode,'remote')

  const teammate=await identity('/magic-link',{email:'operator-own@example.test'}),stranger=await identity('/magic-link',{email:'nobody@example.test'})
  if(provider===relay){
   const redirected=await identity('/magic-link',{email:owner})
   assert.equal(redirected.status,202)
   await app.until(()=>calls===1)
  }
  const asked=await identity('/magic-link',{email:'Owner-Own@Example.test'})
  for(const answer of [teammate,stranger,asked])assert.equal(answer.status,202)
  assert.deepEqual(teammate.data,asked.data);assert.deepEqual(stranger.data,asked.data)
  await app.until(()=>sent.length>0)
  assert.equal(sent.length,1)
  assert.deepEqual(app.requests.map(request=>new URL(request.url).hostname),Array(calls).fill(provider===relay?'platform.example':'api.resend.com'))

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

export async function ownerOnlyMailJourney(){
 await ownerOnlyMail(resend)
 await ownerOnlyMail(relay)
}
