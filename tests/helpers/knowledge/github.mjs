import assert from 'node:assert/strict'
import {startApp,sha} from '../../journeys/kit/app.mjs'

const repository={id:1378012333,full_name:'just-every/run-happytohelp',private:true,default_branch:'main'}

// GitHub as a knowledge source: one-use OAuth into an encrypted credential, and repository discovery in each
// credential mode reading only the selected repositories; provider failures, contacts and other workspaces refused.
export async function githubJourney(k){
 const {app,p}=k,workspace=k.owner,token=k.token,base=`/api/management/projects/${p}/github`
 await app.configure({APP_ORIGIN:'https://support.example.test',GITHUB_CLIENT_ID:'client',GITHUB_CLIENT_SECRET:'secret',INTEGRATION_ENCRYPTION_KEY:btoa('1'.repeat(32))})
 try{
  await app.db.batch([app.db.prepare("INSERT INTO contacts(id,project_id,name,email,external_id,created_at) VALUES('ct',?,'Contact','contact@example.com','contact',1)").bind(p),app.db.prepare("INSERT INTO users VALUES('c','contact@example.com','Contact',1)"),app.db.prepare("INSERT INTO sessions VALUES(?,'c',?,'contact','ct',?,NULL)").bind(sha('contact-token'),p,Date.now()+999999)])
  // OAuth: the state is one-use for this user and project; the stored credential is encrypted.
  const connect=await app.call(base+'/connect',{token,method:'POST',status:200}),authorization=new URL(connect.data.url)
  assert.equal(new URL(authorization.searchParams.get('redirect_uri')).origin,'https://support.example.test');const state=authorization.searchParams.get('state')
  k.provider=async request=>{
   if(request.url==='https://github.com/login/oauth/access_token'){assert.equal(new URL((new URLSearchParams(await request.text())).get('redirect_uri')).origin,'https://support.example.test');return Response.json({access_token:'synthetic-fixture-private-token',scope:'repo'})}
   if(request.url==='https://api.github.com/user')return Response.json({id:1,login:'fixture-user'})
   throw new Error('Unexpected provider request '+request.url)
  }
  const callback=`/api/management/github/callback?state=${state}&code=code`
  assert.equal((await app.request(callback,{token})).status,302);assert.ok([403,409].includes((await app.request(callback,{token})).status),'the state is single use')
  assert.ok(!(await app.first('SELECT token_cipher FROM github_connections WHERE project_id=?',p)).token_cipher.includes('synthetic-fixture-private-token'))
  // With the OAuth connection, discovery lists the person's repositories.
  const calls=[];k.provider=async request=>{calls.push(request.url);assert.equal(request.url,'https://api.github.com/user/repos?per_page=100&sort=updated');return Response.json([{id:7,full_name:'oauth/repo',private:false,default_branch:'trunk'}])}
  assert.deepEqual((await app.call(base+'/repositories',{token,status:200})).data.data,[{id:7,full_name:'oauth/repo',private:false,default_branch:'trunk'}])
  assert.equal((await app.call(base,{token,method:'DELETE',status:200})).data.disconnected,true)
  // Installation tokens, mapped per workspace or for one workspace, read only the selected repositories' metadata.
  await app.db.prepare("INSERT INTO github_settings VALUES(?,?,1,0,1)").bind(p,JSON.stringify(['just-every/run-happytohelp'])).run()
  k.provider=async request=>{calls.push(request.url);assert.equal(request.url,'https://api.github.com/repos/just-every/run-happytohelp');return Response.json(repository)}
  for(const tokens of [{GITHUB_TOKENS:JSON.stringify({[p]:'synthetic-mapped-installation-token'})},{GITHUB_TOKENS:undefined,GITHUB_PROJECT_ID:p,GITHUB_TOKEN:'synthetic-single-project-token'}]){
   await app.configure(tokens);calls.length=0
   assert.deepEqual((await app.call(base+'/repositories',{token,status:200})).data,{data:[repository]});assert.deepEqual(calls,['https://api.github.com/repos/just-every/run-happytohelp'],'never lists /user/repos')
  }
  await app.configure({GITHUB_PROJECT_ID:undefined,GITHUB_TOKEN:undefined,GITHUB_TOKENS:JSON.stringify({[p]:'synthetic-mapped-installation-token'})})
  // A provider refusal or redirect is a bad gateway; a contact or another workspace never reaches the provider.
  k.provider=async()=>Response.json({message:'forbidden'},{status:403});const refused=await app.call(base+'/repositories',{token});assert.equal(refused.status,502);assert.match(JSON.stringify(refused.data),/GitHub HTTP 403/)
  k.provider=async()=>new Response(null,{status:302,headers:{Location:'https://github.com/elsewhere'}});const redirected=await app.call(base+'/repositories',{token});assert.equal(redirected.status,502);assert.match(JSON.stringify(redirected.data),/GitHub HTTP 302/)
  const before=app.requests.length
  assert.equal((await app.call(base+'/repositories',{token:'contact-token'})).status,403);assert.equal((await app.call('/api/management/projects/other/github/repositories',{token})).status,403)
  assert.equal(app.requests.length,before)
 }finally{k.provider=undefined}
}
