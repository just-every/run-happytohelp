import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {totp} from '../identity/two-factor.mjs'

export async function diagnosticRefusals(app,runtime,state){
 const {token,p,door,base,control,overlap,a,receipt}=state
 const call=(path,options={})=>app.call(path,{token,...options})
 const refused=async(path,options,status)=>{const response=await call(path,options);assert.equal(response.status,status);assert.equal(response.headers.get('cache-control'),'no-store');return response}
 await refused(door+'/counts',{token:null},401)
 await refused(door+'/counts',{token:'int_'+'a'.repeat(64)},404)
 const valid=new URLSearchParams({scenario:'control',messageId:control.id,from:String(state.started),to:String(Date.now())})
 for(const query of ['sql=SELECT','synthetic=true','table=messages','export=csv','sort=created_at','projectId=foreign','x=%25','scenario=all',valid+'&scenario=control',new URLSearchParams({...Object.fromEntries(valid),messageId:'%'}).toString(),new URLSearchParams({...Object.fromEntries(valid),from:'0'}).toString()]){
  const path=door+(query=== 'synthetic=true'?'/counts':'/receipts')+'?'+query
  const result=await refused(path,{},400);assert.equal(result.data.error,'Invalid C2 diagnostic selector')
 }
 await refused(door+'/receipts',{},400)
 assert.equal((await call(`/api/dashboard/projects/${p}/diagnostics/c2/counts`)).status,404,'diagnostics are not mounted on the dashboard alias')
 const foreign=await runtime.seedTenant({name:'Foreign harbour',email:'foreign@desk-proof.example',allowedOrigin:runtime.origin})
 await refused(`/api/management/projects/${foreign.projectId}/diagnostics/c2/counts`,{},403)
 await refused(door+'/counts',{token:foreign.token},403)
 const foreignProject=(await app.call('/api/identity/projects/'+foreign.projectId,{token:foreign.token,status:200})).data
 const visitor=(await app.call('/api/identity/widget/session',{body:{widgetKey:foreignProject.widget_key,email:'foreign-visitor@desk-proof.example',name:'Foreign visitor'},headers:{Origin:runtime.origin},status:201})).data
 await refused(door+'/counts',{token:visitor.token},403)
 const foreignConversation=(await app.call('/api/conversations',{token:visitor.token,body:{projectId:foreign.projectId},status:201})).data
 await app.call(`/api/conversations/${foreignConversation.id}/messages`,{token:visitor.token,body:{localId:'foreign-message',content:'A private synthetic question.',expectedRevision:0},status:200})
 const empty=await receipt('control',control,{conversationId:foreignConversation.id,localId:`c2scratch4-ctl-${Date.now()}`})
 const absent=await receipt('control',control,{conversationId:'absent',localId:`c2scratch4-ctl-${Date.now()}`})
 assert.deepEqual(empty,absent,'foreign and missing requested identifiers have the same projection')
 const foreignQuery=new URLSearchParams({scenario:'new-overlap',messageId:overlap.id,conversationId:state.c,from:String(state.started),to:String(Date.now())})
 const foreignFacts=(await app.call(`/api/management/projects/${foreign.projectId}/diagnostics/c2/receipts?${foreignQuery}`,{token:foreign.token,status:200})).data.data
 assert.deepEqual({...foreignFacts,deliveries:[]},{customerMessages:0,senderConversations:0,inboundRows:0,conversationMessages:0,savedReplies:0,receipts:[],deliveries:[]})
 assert.equal(foreignFacts.deliveries.reduce((sum,row)=>sum+row.count,0),1,'the foreign project sees only its own ordinary request acknowledgment')
 const invitation=(await call(base+'/agents',{body:{email:'diagnostic-admin@desk-proof.example',role:'admin'},status:201})).data.data
 await app.call('/api/identity/accept-token',{body:{token:new URL(invitation.invitationUrl).searchParams.get('token'),name:'Diagnostic admin',password:'synthetic-c2-admin-password'},status:200})
 const login=async()=>app.call('/api/identity/login',{body:{email:'diagnostic-admin@desk-proof.example',password:'synthetic-c2-admin-password'},status:200})
 const admin=await login(),userId=admin.data.actor.id
 await call(door+'/counts',{token:admin.data.token,status:200})
 for(const selection of [{permissions:[]},{permissions:['settings.manage'],ticketScope:{groupIds:[],includeUngrouped:true}},{permissions:['settings.manage'],knowledgeArticleIds:[]}]){
  const role=(await call(base+'/roles',{body:{name:'Diagnostic scope '+Math.random(),base:'admin',...selection},status:201})).data.data
  await call(base+'/agents/'+userId,{method:'PUT',body:{role:role.id},status:200})
  await refused(door+'/counts',{token:admin.data.token},403)
  await refused(door+'/receipts?'+valid,{token:admin.data.token},403)
 }
 await call(base+'/agents/'+userId,{method:'PUT',body:{role:'operator'},status:200})
 const operator=await login();await refused(door+'/counts',{token:operator.data.token},403)
 // Expiry cannot be advanced through a product door. Only the auth fixture is
 // expired in isolated D1; none of the scenario's business rows is read or changed.
 const expiring=(await app.call('/api/identity/login',{body:{email:'owner@desk-proof.example',password:'synthetic-c2-owner-password'},status:200})).data.token
 const digest=createHash('sha256').update(expiring).digest('hex')
 await runtime.execute(`UPDATE sessions SET expires_at=1 WHERE token_hash='${digest}'`)
 await refused(door+'/counts',{token:expiring},401)
 await app.call('/api/identity/session',{token:operator.data.token,method:'DELETE',status:200})
 await refused(door+'/counts',{token:operator.data.token},401)
 const factor=(await call('/api/identity/two-factor/totp',{body:{},status:201})).data
 await call('/api/identity/two-factor/totp/confirm',{body:{factorId:factor.factorId,code:totp(factor.secret)},status:201})
 await call(base+'/security',{method:'PUT',body:{two_factor_roles:['operator']},status:200})
 const pending=await login()
 assert.ok(pending.data.twoFactor)
 const factorRefusal=await refused(door+'/counts',{token:pending.data.token},401)
 assert.equal(factorRefusal.data.code,'two_factor_required')
 // Receipt IDs remain exact, not prefixes, and a missing exact synthetic ID stays absent.
 const missing=await receipt('new-overlap',{id:'<ovl.000000000000@desk-proof.example>'})
 assert.equal(missing.inboundRows,0);assert.equal(missing.customerMessages,0);assert.deepEqual(missing.receipts,[])
}
