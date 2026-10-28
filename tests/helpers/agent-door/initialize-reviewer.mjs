import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'

// This is verifier tooling. Invitation, password setup and session creation all
// use the production native lifecycle; no synthetic account or session is stored.
export default async function({request,origin,email,owner,returnTo='/agents'}){
 const call=async(path,body,cookie=owner.cookie)=>{
  const response=await request(origin+path,{method:body===undefined?'GET':'POST',headers:{Origin:origin,Cookie:cookie,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})})
  assert.ok(response.ok,'Native reviewer lifecycle refused')
  return response
 }
 const projects=await (await call('/api/management/projects')).json()
 assert.equal(projects.data.length,1,'The verifier links one native project')
 const invitation=await (await call(`/api/management/projects/${projects.data[0].id}/agents`,{email})).json()
 const password=randomBytes(32).toString('base64url')
 await call('/api/identity/accept-token',{token:new URL(invitation.data.invitationUrl).searchParams.get('token'),name:'Jordan Support',password},'')
 const login=await call('/api/identity/login',{email,password},'')
 const cookies=login.headers.getSetCookie()
 assert.ok(cookies.length,'The native reviewer signs in with a new session')
 return new Response(null,{status:303,headers:[['Location',returnTo],...cookies.map(value=>['Set-Cookie',value])]})
}
