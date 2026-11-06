import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {startApp} from '../../journeys/kit/app.mjs'
import {memberFor,issueGrant,signInLink,SigninRefusal} from '../../../scripts/hosted-signin/grant.mjs'

// An installation that sends nothing: every request that would send refuses in words, no mail
// provider is ever contacted, and a grant written the way scripts/hosted-signin.mjs writes it
// admits exactly the named owner through the same door an emailed link uses. Nothing is faked
// but the network, which is not reached.
export async function mailOffJourney(){
 const provider=[],app=await startApp({bindings:{APP_ORIGIN:'https://app.example'},outbound:async request=>{provider.push(request.url);return new Response('unexpected',{status:500})}})
 try{
  const identity=(path,body,headers)=>app.call('/api/identity'+path,{body,headers})
  const workspace=await app.seedWorkspace('off'),owner='owner-off@example.test'
  // Asking for a link refuses; it never answers "check your inbox".
  const asked=await identity('/magic-link',{email:owner})
  assert.equal(asked.status,503);assert.match(asked.data.error,/Outbound email is off for this installation/)
  const reset=await identity('/forgot-password',{email:owner})
  assert.equal(reset.status,503);assert.match(reset.data.error,/Outbound email is off for this installation/)
  assert.equal((await app.call('/api/identity/sign-in-options')).data.mailMode,'unavailable')

  // The grant: the workspace's single owner, one use, only its hash stored.
  const member=await memberFor(app.db,{project:workspace.projectId})
  assert.equal(member.email,owner)
  await assert.rejects(memberFor(app.db,{email:'operator-off@example.test'}),SigninRefusal)
  await assert.rejects(memberFor(app.db,{email:'nobody@example.test'}),SigninRefusal)
  const grant=await issueGrant(app.db,member),link=new URL(signInLink(app.origin,grant.token))
  assert.equal(link.pathname,'/login/magic');assert.equal(new URLSearchParams(link.hash.slice(1)).get('token'),grant.token)
  const stored=await app.sql('SELECT token_hash,email,consumed_at FROM magic_signins')
  assert.deepEqual(stored.map(row=>row.token_hash),[createHash('sha256').update(grant.token).digest('hex')])
  const entered=await identity('/magic-link/consume',{token:grant.token})
  assert.equal(entered.status,200);assert.equal(entered.data.signedIn,true)
  const session=await app.call('/api/identity/session',{headers:{Cookie:entered.headers.get('set-cookie').split(';')[0]}})
  assert.equal(session.data.id,workspace.users.owner);assert.equal(session.data.projectId,workspace.projectId)
  assert.equal((await identity('/magic-link/consume',{token:grant.token})).status,400)

  // A role that changed after the lookup writes no grant.
  await app.db.prepare("UPDATE memberships SET role='operator' WHERE project_id=? AND user_id=?").bind(workspace.projectId,workspace.users.owner).run()
  await assert.rejects(issueGrant(app.db,member),SigninRefusal)
  assert.deepEqual(provider,[]);assert.deepEqual(app.requests,[])
 }finally{await app.close()}
}
