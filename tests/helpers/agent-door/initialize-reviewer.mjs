import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'

/** Native invitation, password creation and sign-in; no database or session writes. */
export default async function({request,origin,email,owner,returnTo='/agents'}){
 const json=async(path,body,cookie)=>{
  const response=await request(origin+path,{method:body===undefined?'GET':'POST',headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})})
  assert.ok(response.ok,'Native reviewer lifecycle refused with HTTP '+response.status)
  return {response,data:await response.json()}
 }
 const {data:session}=await json('/api/identity/session',undefined,owner.cookie)
 const {data:invitation}=await json(`/api/management/projects/${session.projectId}/agents`,{email},owner.cookie)
 const password=randomBytes(32).toString('base64url')
 await json('/api/identity/accept-token',{token:new URL(invitation.data.invitationUrl).searchParams.get('token'),name:'Riley Quality',password})
 const {response,data}=await json('/api/identity/login',{email,password})
 assert.notEqual(data.actor.id,session.id,'Reviewer must be a distinct native person')
 assert.equal(data.actor.projectId,session.projectId)
 return new Response(null,{status:303,headers:[['Location',returnTo],...response.headers.getSetCookie().map(value=>['Set-Cookie',value])]})
}
