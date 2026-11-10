import assert from 'node:assert/strict'
import {startApp} from '../../journeys/kit/app.mjs'

// While a workspace's knowledge conversion is unfinished, the Worker holds knowledge routes closed for anyone
// without a member session. Signing in touches no knowledge row, so it must stay open: an imported owner has no
// password, and the emailed link is their only way in. Network is the only fake (the mail provider).
export async function upgradeFenceJourney(){
 const mail=[],app=await startApp({bindings:{APP_ORIGIN:'https://app.example',EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'synthetic-mail-edge-key',EMAIL_FROM:'support@example.test'},outbound:async request=>{
  assert.equal(new URL(request.url).host,'api.resend.com');mail.push(await request.json());return Response.json({id:'synthetic-mail-'+mail.length})
 }})
 try{
  const workspace=await app.seedWorkspace('fence'),p=workspace.projectId,owner='owner-fence@example.test'
  await app.db.batch([
   app.db.prepare("UPDATE knowledge_upgrade_reports SET completed_at=NULL WHERE project_id=?").bind(p),
   app.db.prepare('INSERT OR IGNORE INTO knowledge_upgrade_progress(project_id,updated_at) VALUES(?,?)').bind(p,Date.now()),
  ])
  const identity=(path,body,headers)=>app.call('/api/identity'+path,{body,headers})

  // The fence is up: knowledge answers 503 with a retry interval to an anonymous caller and to a signed-out dashboard read.
  for(const path of [`/api/knowledge/public/${p}/articles`,`/api/knowledge/${p}/articles`]){
   const closed=await app.call(path);assert.equal(closed.status,503,path);assert.ok(Number(closed.headers.get('retry-after'))>0)
  }

  // Identity entry answers an anonymous caller normally.
  const setup=await app.call('/api/identity/setup');assert.equal(setup.status,200);assert.equal(setup.data.available,false)
  assert.equal((await app.call('/api/identity/setup-status')).status,200)
  assert.equal((await app.call('/api/identity/auth-options')).status,200)
  const options=await app.call('/api/identity/sign-in-options');assert.equal(options.status,200);assert.notEqual(options.data.mailMode,'unavailable')
  const asked=await identity('/magic-link',{email:owner});assert.equal(asked.status,202)
  await app.until(()=>mail.some(message=>message.to.includes(owner)&&message.text.includes('#token=')),{message:'the sign-in link is mailed'})
  const link=mail.filter(message=>message.to.includes(owner)).at(-1).text.match(/https?:\/\/\S+/)[0]
  const entered=await identity('/magic-link/consume',{token:new URLSearchParams(new URL(link).hash.slice(1)).get('token')})
  assert.equal(entered.status,200);assert.equal(entered.data.signedIn,true)

  // The session from that link, and an existing session, work; knowledge stays closed to anyone without one.
  const cookie=entered.headers.get('set-cookie').split(';')[0]
  assert.equal((await app.call('/api/identity/session',{headers:{Cookie:cookie}})).data.projectId,p)
  assert.equal((await app.call(`/api/knowledge/${p}/articles`,{headers:{Cookie:cookie}})).status,200,'the emailed link admits a member to knowledge')
  assert.equal((await app.call(`/api/knowledge/${p}/articles`,{token:workspace.tokens.owner})).status,200,'an existing member session still reads knowledge')
  assert.equal((await app.call(`/api/knowledge/public/${p}/articles`)).status,503,'the public knowledge route is still closed')
  assert.equal((await app.first('SELECT completed_at FROM knowledge_upgrade_reports WHERE project_id=?',p)).completed_at,null,'the conversion was pending throughout')
 }finally{await app.close()}
}
