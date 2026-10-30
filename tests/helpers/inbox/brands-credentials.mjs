import assert from 'node:assert/strict'
import {startApp} from '../../journeys/kit/app.mjs'

// Two independent accounts issue different credentials at the provider HTTP edge.
// The application performs OAuth, encryption, selection and polling unchanged.
export async function brandCredentialOutcomes(){
 const accounts=['alpha','beta'].map(label=>({label,address:`care@${label}.example.test`,accessToken:`synthetic-${label}-access`,refreshToken:`synthetic-${label}-refresh`}))
 let expectedAccount
 const polls=[]
 const app=await startApp({bindings:{APP_ORIGIN:'https://app.example',H2H_SETUP_TOKEN:'synthetic-brand-setup',INTEGRATION_ENCRYPTION_KEY:Buffer.alloc(32,19).toString('base64'),GOOGLE_MAIL_CLIENT_ID:'synthetic-brand-client',GOOGLE_MAIL_CLIENT_SECRET:'synthetic-brand-secret'},outbound:async request=>{
  const url=new URL(request.url)
  if(url.hostname==='oauth2.googleapis.com'&&url.pathname==='/token'){
   const body=new URLSearchParams(await request.text()),account=accounts.find(row=>row.label===body.get('code'))
   assert.ok(account);assert.ok(body.get('code_verifier'))
   return Response.json({access_token:account.accessToken,refresh_token:account.refreshToken,expires_in:3600,token_type:'Bearer'})
  }
  assert.equal(url.hostname,'gmail.googleapis.com')
  const account=accounts.find(row=>request.headers.get('authorization')==='Bearer '+row.accessToken)
  assert.ok(account);assert.equal(account,expectedAccount,'only the selected brand credential reaches its provider')
  polls.push(account.label)
  if(url.pathname.endsWith('/profile'))return Response.json({emailAddress:account.address,historyId:'1'})
  if(url.pathname.endsWith('/settings/sendAs'))return Response.json({sendAs:[{sendAsEmail:account.address,verificationStatus:'accepted'}]})
  if(url.pathname.endsWith('/messages'))return Response.json({messages:[]})
  throw new Error('Unexpected provider operation '+url.pathname)
 }})
 try{
  const email='brand-owner@example.test',password='synthetic-brand-owner-password'
  const first=await app.ok('/api/identity/bootstrap',{body:{email,password,name:'Credential Alpha',allowedOrigin:'https://alpha.example.test',setupToken:'synthetic-brand-setup'}})
  const owner=(await app.ok('/api/identity/login',{body:{email,password}})).token
  const second=await app.ok('/api/management/projects',{token:owner,body:{name:'Credential Beta',allowed_origin:'https://beta.example.test'}})
  const records=[]
  for(const [i,projectId] of [first.projectId,second.id].entries()){
   const token=(await app.ok('/api/identity/switch-project',{token:owner,body:{projectId}})).token
   const base=`/api/management/projects/${projectId}/mailboxes`,account=accounts[i]
   expectedAccount=account
   const started=await app.ok(base+'/connect',{token,body:{provider:'gmail'}}),state=new URL(started.url).searchParams.get('state')
   assert.equal((await app.call(`/api/management/mailboxes/oauth/gmail/callback?state=${state}&code=${account.label}`,{token})).status,302)
   const listing=await app.ok(base,{token}),box=listing.data.find(row=>row.address===account.address)
   assert.ok(box);assert.equal(box.status,'connected')
   records.push({projectId,token,base,box,account})
  }
  const selected=records.map(row=>row.projectId).join(',')
  const manifest=(await app.ok(`/api/management/projects/${first.projectId}/brands?projects=${selected}`,{token:owner})).data
  for(const own of records){
   const foreign=records.find(row=>row!==own),listing=await app.ok(own.base,{token:own.token})
   assert.deepEqual(listing.data.map(row=>row.id),[own.box.id])
   assert.deepEqual(manifest.brands.find(row=>row.id===own.projectId).mailboxes.map(row=>row.id),[own.box.id])
   const publicData=JSON.stringify({listing,manifest})
   for(const account of accounts)for(const value of [account.accessToken,account.refreshToken])assert.ok(!publicData.includes(value),'mailbox and brand views never expose either account credential')
   const before=polls.length
   for(const [suffix,method,body] of [['/poll','POST',{}],['/reconnect','POST',{}],['','PATCH',{senderAddress:foreign.account.address}]]){
    const refused=await app.call(own.base+`/${foreign.box.id}`+suffix,{token:own.token,method,body})
    assert.equal(refused.status,404);assert.match(refused.data.error,/mailbox|not found/i)
   }
   assert.equal(polls.length,before,'foreign mailbox actions never use a provider credential')
   expectedAccount=own.account
   assert.equal((await app.ok(own.base+`/${own.box.id}/poll`,{token:own.token,body:{}})).received,0)
   assert.ok(polls.length>before)
  }
 }finally{await app.close()}
}
