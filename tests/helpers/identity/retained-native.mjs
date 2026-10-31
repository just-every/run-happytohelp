import assert from 'node:assert/strict'
import {startApp} from '../../journeys/kit/app.mjs'

// Provider credentials belong to the installation. Configure/restart the real
// Worker over the same store, then recover and re-enter with native credentials.
// Only the mail delivery edge is replaced; no identity or storage is stubbed.
export async function retainedNativeIdentityJourney(){
 const mail=[],setupToken='synthetic-retained-native-setup'
 const app=await startApp({bindings:{H2H_SETUP_TOKEN:setupToken,APP_ORIGIN:'https://app.example'},outbound:async request=>{
  assert.equal(new URL(request.url).origin,'https://api.resend.com','native identity never delegates authentication to a provider')
  mail.push(await request.json())
  return Response.json({id:'synthetic-retained-native-mail-'+mail.length})
 }})
 try{
  const identity=(path,body,token,status=200)=>app.call('/api/identity'+path,{body,token,status})
  const email='retained-owner@example.test',password='synthetic-retained-native-password'
  const setup=(await identity('/bootstrap',{email,password,allowedOrigin:'https://customer.example',setupToken},undefined,201)).data
  const {projectId,userId}=setup
  await app.call(`/api/management/projects/${projectId}/availability`,{method:'PUT',body:{is_presence_away_enabled:false,is_availability_schedule_enabled:false},token:setup.token,status:200})
  const project=(await identity('/projects/'+projectId,undefined,setup.token)).data
  const visitor=await app.ok('/api/identity/widget/session',{body:{widgetKey:project.widget_key,email:'retained-customer@example.test'},headers:{Origin:project.allowed_origin}})
  const thread=await app.ok('/api/conversations',{body:{projectId},token:visitor.token})
  const content='My support request must remain with the native owner.'
  const sent=await app.ok(`/api/conversations/${thread.id}/messages`,{body:{localId:'retained-native-request',content,expectedRevision:0},token:visitor.token})
  assert.equal(sent.accepted,true)

  const providerKeys={OPENAI_API_KEY:'synthetic-retained-openai',ANTHROPIC_API_KEY:'synthetic-retained-anthropic',GOOGLE_API_KEY:'synthetic-retained-google',DEEPSEEK_API_KEY:'synthetic-retained-deepseek',XAI_API_KEY:'synthetic-retained-xai',OPENROUTER_API_KEY:'synthetic-retained-openrouter',GITHUB_CLIENT_ID:'synthetic-retained-github-client',GITHUB_CLIENT_SECRET:'synthetic-retained-github-secret'}
  await app.configure({...providerKeys,EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'synthetic-retained-mail-key',EMAIL_FROM:'support@example.test',RER_MANAGEMENT_ORIGIN:'https://management.example.test',RER_INSTALLATION_ID:'synthetic-retained-installation',H2H_SETUP_TOKEN:undefined})
  assert.equal((await identity('/auth-options')).data.setupRequired,false,'provider configuration cannot reopen native setup')
  const editor=(await identity('/editor-config',undefined,setup.token)).data
  assert.equal(editor.enabled,true,'the installation management provider is configured')
  assert.equal(editor.managementOrigin,'https://management.example.test')
  assert.equal((await identity('/auth-options')).data.recoveryAvailable,true,'the configured mail provider enables native recovery')
  assert.equal((await app.ok(`/api/management/projects/${projectId}/ai`,{token:setup.token})).data.ready,true,'the installed model provider is available to the workspace')
  assert.equal(mail.length,0,'configuring providers performs no identity or mail exchange')

  const assertOwner=async token=>{
   const session=(await identity('/session',undefined,token)).data
   assert.deepEqual([session.id,session.projectId,session.role],[userId,projectId,'owner'])
   const profile=await app.ok('/api/management/profile',{token})
   assert.equal(profile.data.email,email)
   assert.equal(profile.data.has_password,1)
   const transcript=await app.ok(`/api/conversations/${thread.id}/messages`,{token})
   assert.deepEqual(transcript.messages.map(message=>[message.id,message.content]),[[sent.message.id,content]])
   assert.equal(transcript.revision,sent.message.revision)
  }
  await assertOwner(setup.token)
  await identity('/login',{email,password:providerKeys.OPENAI_API_KEY},undefined,401)
  const login=(await identity('/login',{email,password,projectId})).data
  await assertOwner(login.token)

  await identity('/forgot-password',{email})
  assert.equal(mail.length,1,'the configured mail edge delivers one native owner recovery link')
  assert.deepEqual(mail[0].to,[email])
  const link=new URL(mail[0].text.match(/https?:\/\/\S+/)[0]),token=link.searchParams.get('token')
  assert.equal(link.origin,'https://app.example')
  assert.equal(link.pathname,'/reset-password')
  assert.ok(token)
  const recoveredPassword='synthetic-retained-native-recovered-password'
  assert.equal((await identity('/accept-token',{token,password:recoveredPassword})).data.loginRequired,true)
  await identity('/accept-token',{token,password:recoveredPassword},undefined,400)
  await identity('/session',undefined,setup.token,401)
  await identity('/session',undefined,login.token,401)
  await identity('/login',{email,password},undefined,401)
  const recovered=await identity('/login',{email,password:recoveredPassword,projectId})
  await assertOwner(recovered.data.token)
  const cookie=recovered.headers.get('set-cookie').split(';')[0]
  const session=await app.ok('/api/identity/session',{headers:{Cookie:cookie}})
  assert.deepEqual([session.id,session.projectId,session.role],[userId,projectId,'owner'])
  await app.call('/api/identity/session',{method:'DELETE',token:recovered.data.token,status:200})
  await identity('/session',undefined,recovered.data.token,401)

  // Removing or rotating installation providers must also retain the recovered
  // password, owner identity and original workspace transcript after restart.
  await app.configure({...Object.fromEntries(Object.keys(providerKeys).map(key=>[key,undefined])),EMAIL_PROVIDER:undefined,EMAIL_API_KEY:undefined,EMAIL_FROM:undefined,RER_MANAGEMENT_ORIGIN:undefined,RER_INSTALLATION_ID:undefined})
  const reentered=(await identity('/login',{email,password:recoveredPassword,projectId})).data
  await assertOwner(reentered.token)
  assert.equal((await identity('/editor-config',undefined,reentered.token)).data.enabled,false)
  assert.equal((await app.ok(`/api/management/projects/${projectId}/ai`,{token:reentered.token})).data.ready,false)
  assert.equal((await identity('/auth-options')).data.setupRequired,false)
  assert.equal(mail.length,1,'workspace re-entry needs no provider authentication or mail')
 }finally{await app.close()}
}
