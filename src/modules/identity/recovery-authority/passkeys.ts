import {installationOrigin} from '../two-factor/factors'
import {b64url,fromB64url,verifyAssertion,verifyRegistration,WebAuthnError,type AssertionInput} from '../two-factor/webauthn'
import {registrationVerified} from './passkey-proof'
import {guarded,random,refuse,type Predicate,type RecoveryContext} from './common'
import {audit,type RequestRow} from './store'
type PendingPasskey=Awaited<ReturnType<typeof verifyRegistration>>
/** Registration stages a public credential only. A second, signed ceremony
 * proves possession of that new private key before completion may admit anyone. */
export async function passkeyOptions(c:RecoveryContext,row:RequestRow,predicate:Predicate,body:any){
 const rp=installationOrigin(c.env,c.req.url),db=c.env.DB,challenge=random()
 if(body.credential){
  if(!row.passkey_challenge||row.pending_passkey||!row.passkey_expires||row.passkey_expires<=Date.now())refuse()
  let registered:PendingPasskey
  try{
   registered=await verifyRegistration(body.credential,{challenge:row.passkey_challenge,origin:rp.origin,rpId:rp.id})
   await registrationVerified(body.credential)
  }catch(error){if(error instanceof WebAuthnError){await audit(c.env,'refused','replacement_invalid',row);refuse()}throw error}
  if(await db.prepare('SELECT 1 FROM user_factors WHERE credential_id=?').bind(registered.credentialId).first())refuse()
  await guarded(db,{sql:`(${predicate.sql}) AND EXISTS(SELECT 1 FROM identity_recovery_requests WHERE id=? AND passkey_challenge=? AND pending_passkey IS NULL AND passkey_expires>unixepoch('subsec')*1000)`,args:[...predicate.args,row.id,row.passkey_challenge]},[
   db.prepare('UPDATE identity_recovery_requests SET pending_passkey=?,passkey_challenge=?,passkey_expires=?,pending_secret=NULL,pending_id=NULL WHERE id=?').bind(JSON.stringify(registered),challenge,Date.now()+120000,row.id),
  ])
  return {publicKey:{challenge,rpId:rp.id,timeout:120000,userVerification:'required',allowCredentials:[{type:'public-key',id:registered.credentialId}]}}
 }
 const user=await db.prepare('SELECT email,name FROM users WHERE id=?').bind(row.user_id).first<{email:string;name:string}>()
 await guarded(db,predicate,[db.prepare('UPDATE identity_recovery_requests SET passkey_challenge=?,passkey_expires=?,pending_secret=NULL,pending_id=NULL,pending_passkey=NULL WHERE id=?').bind(challenge,Date.now()+120000,row.id)])
 return {publicKey:{challenge,rp:{id:rp.id,name:'HappyToHelp'},user:{id:b64url(new TextEncoder().encode(row.user_id)),name:user!.email,displayName:user!.name},pubKeyCredParams:[{type:'public-key',alg:-7},{type:'public-key',alg:-257}],timeout:120000,attestation:'none',authenticatorSelection:{residentKey:'preferred',userVerification:'required'},excludeCredentials:[]}}
}
export async function proveReplacementPasskey(c:RecoveryContext,row:RequestRow,input:AssertionInput){
 if(!row.pending_passkey||!row.passkey_challenge||!row.passkey_expires||row.passkey_expires<=Date.now())refuse()
 const pending=JSON.parse(row.pending_passkey) as PendingPasskey,rp=installationOrigin(c.env,c.req.url)
 if(input?.id!==pending.credentialId)refuse()
 try{
  const verified=await verifyAssertion(input,pending,{challenge:row.passkey_challenge,origin:rp.origin,rpId:rp.id})
  // UV is part of the newly signed authenticator data, not a client assertion.
  const data=fromB64url(input.response.authenticatorData)
  if(!(data[32]&0x04))refuse()
  return {...pending,signCount:verified.signCount}
 }catch(error){if(error instanceof WebAuthnError){await audit(c.env,'refused','replacement_invalid',row);refuse()}throw error}
}
