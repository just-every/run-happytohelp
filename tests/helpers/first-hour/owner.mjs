import assert from 'node:assert/strict'
import {startApp} from '../../journeys/kit/app.mjs'

const localOrigin='http://127.0.0.1:8787'
const localBindings={H2H_LOCAL:'true',APP_ORIGIN:localOrigin,RER_DEV_KEY:'synthetic-local-owner-custody-key-for-flow-tests',EMAIL_PROVIDER:'development'}
const ownerInput={setupToken:'synthetic-first-hour-claim',email:'synthetic-owner@example.test',password:'synthetic-first-hour-password',allowedOrigin:localOrigin}
const localApp=()=>startApp({origin:localOrigin,bindings:localBindings,entry:'tests/helpers/first-hour/dev-worker.ts'})
const claim=async app=>(await app.call('/api/identity/bootstrap',{body:ownerInput,status:201})).data
const gateHeaders={'x-rer-dev-key':localBindings.RER_DEV_KEY}
async function enter(app,headers=gateHeaders){
 const response=await app.call('/auth/dev/enter',{headers,status:303})
 const token=response.headers.get('set-cookie').match(/h2h_session=([^;]+)/)?.[1]
 assert.ok(token,'existing local entry issues a native session')
 return token
}

export async function localOwnerReentry(){
 const app=await localApp()
 try{
  await claim(app)
  const exchange=await app.call('/__dev/key',{body:{key:localBindings.RER_DEV_KEY},headers:{Origin:localOrigin},status:204})
  const admitted={Cookie:exchange.headers.get('set-cookie').split(';')[0]}
  const initial=await enter(app,admitted)
  await app.call('/api/identity/session',{method:'DELETE',token:initial,headers:admitted,status:200})
  await app.call('/api/identity/session',{token:initial,status:401})
  assert.equal((await app.call('/api/identity/auth-options',{headers:admitted,status:200})).data.localOwnerEntry,true)
  const returned=await enter(app,admitted)
  assert.equal((await app.call('/api/identity/session',{token:returned,headers:gateHeaders,status:200})).data.role,'owner')
  for(const headers of [{},{...gateHeaders,Origin:'https://foreign.example'}, {...gateHeaders,'Sec-Fetch-Site':'cross-site'}]){
   await app.call('/auth/dev/enter',{headers,status:404})
   const options=await app.call('/api/identity/auth-options',{headers});assert.ok(options.status===403||options.data.localOwnerEntry!==true)
  }
  await app.call('/api/identity/session',{token:returned,status:401})
  for(const changes of [{RER_INSTALLATION_ID:'synthetic-managed-installation'},{APP_ORIGIN:'https://hosted.example'},{RER_DEV_IDENTITY:'off'},{RER_DEV_KEY:undefined},{H2H_LOCAL:'false'}]){
   await app.configure({RER_INSTALLATION_ID:undefined,RER_DEV_IDENTITY:undefined,...localBindings,...changes})
   await app.call('/auth/dev/enter',{headers:gateHeaders,status:404})
  }
 }finally{await app.close()}
}

export async function localOwnerPassword(){
 const app=await localApp()
 try{
  const account=await claim(app),token=await enter(app)
  const profile=(await app.call('/api/management/profile',{token,headers:gateHeaders,status:200})).data.data
  assert.equal(profile.password_installation_confirmed,true)
  const next='synthetic-owner-chosen-password'
  await app.call('/api/identity/password',{token,headers:gateHeaders,body:{password:next},status:200})
  await app.call('/api/identity/session',{token,headers:gateHeaders,status:401})
  await app.call('/api/identity/session',{token:account.token,status:401})
  await app.call('/api/identity/login',{body:{email:ownerInput.email,password:ownerInput.password},status:401})
  const signed=(await app.call('/api/identity/login',{body:{email:ownerInput.email,password:next},status:200})).data
  assert.equal((await app.call('/api/identity/session',{token:signed.token,status:200})).data.role,'owner')
  assert.equal((await app.call('/api/management/profile',{token:signed.token,status:200})).data.data.password_installation_confirmed,false)
  await app.call('/api/identity/password',{token:signed.token,body:{password:'synthetic-refused-replacement'},status:403})
  await app.call('/api/identity/login',{body:{email:ownerInput.email,password:next},status:200})
  assert.equal(app.requests.length,0,'local password choice uses no email or provider')
 }finally{await app.close()}
}

export async function deviceHoursTimezone(){
 const app=await startApp({bindings:{APP_ORIGIN:'https://app.example',H2H_SETUP_TOKEN:ownerInput.setupToken}})
 try{
  const account=await claim(app),path=`/api/management/projects/${account.projectId}`
  const hours={is_availability_schedule_enabled:true,availability_schedule:{days:[1,2,3,4,5],time_from:'09:00',time_to:'17:00'}}
  await app.call(path+'/availability',{method:'PUT',token:account.token,body:{...hours,device_timezone:'Australia/Brisbane'},status:200})
  assert.equal((await app.call(path+'/settings',{token:account.token,status:200})).data.data.timezone,'Australia/Brisbane')
  const availability=(await app.call(path+'/presence',{token:account.token,status:200})).data.data.availability
  assert.equal(availability.timezone,'Australia/Brisbane')
  await app.call(path+'/settings',{method:'PUT',token:account.token,body:{timezone:'UTC'},status:200})
  await app.call(path+'/availability',{method:'PUT',token:account.token,body:{...hours,device_timezone:'Australia/Brisbane'},status:200})
  assert.equal((await app.call(path+'/settings',{token:account.token,status:200})).data.data.timezone,'UTC','explicitly chosen UTC wins')
  await app.call(path+'/availability',{method:'PUT',token:account.token,body:{...hours,device_timezone:'Not/AZone'},status:400})
 }finally{await app.close()}
}

export async function externalWidgetConfirmation(){
 const app=await startApp({origin:localOrigin,bindings:{APP_ORIGIN:localOrigin,H2H_LOCAL:'true',EMAIL_PROVIDER:'development'}})
 try{
  const account=await claim(app),path=`/api/management/projects/${account.projectId}`,check=async()=>(await app.call(path+'/activation/check',{token:account.token,body:{step:'widget_seen'},status:200})).data.data.steps.find(s=>s.id==='widget_seen')
  const ping=async(origin,key)=>{
   const visitor=(await app.call('/api/identity/widget/session',{headers:{Origin:origin},body:{widgetKey:key},status:201})).data
   const conversation=(await app.call('/api/conversations',{token:visitor.token,body:{projectId:account.projectId},status:201})).data
   await app.call(`/api/conversations/${conversation.id}/widget-events`,{token:visitor.token,headers:{Origin:origin},body:{action:'pingActive',data:{opened:true}},status:200})
  }
  const widget=(await app.call(path+'/widget-settings',{token:account.token,status:200})).data.widgetKey
  await app.call(path+'/activation/skip',{token:account.token,body:{step:'widget_seen',skipped:true},status:200})
  await ping(localOrigin,widget)
  assert.equal((await app.sql('SELECT * FROM activation_widget_pings WHERE project_id=?',account.projectId)).length,1,'app activity remains recorded')
  assert.notEqual((await check()).state,'done','the app homepage never confirms installation')
  assert.equal((await check()).placement,'skipped')
  const website='https://synthetic-owner-site.example'
  await app.call(path+'/widget-settings',{method:'PUT',token:account.token,body:{allowed_origin:website},status:200})
  assert.notEqual((await check()).state,'done','saving a different website is not an observation')
  await ping(website,widget)
  const confirmed=await check();assert.equal(confirmed.state,'done');assert.equal(confirmed.placement,'set')
  assert.match(confirmed.detail,/synthetic-owner-site/)
  assert.equal((await app.first('SELECT origin FROM activation_widget_pings WHERE project_id=?',account.projectId)).origin,website,'existing last-observation recording is retained')
 }finally{await app.close()}
}
