import assert from 'node:assert/strict'
import {startApp} from '../../journeys/kit/app.mjs'
export async function assuranceJourney(){
 const app=await startApp()
 try{
 const ws=await app.seedWorkspace('assurance'),foreign=await app.seedWorkspace('assurance-foreign'),token=ws.tokens.owner,base=`/api/assurance/projects/${ws.projectId}`,headers={Origin:ws.allowedOrigin,'CF-Connecting-IP':'198.51.100.70'}
 const call=(path='',body,options={})=>app.ok(base+path,{token,body,...options})
 const person=await app.ok('/api/identity/widget/session',{headers,body:{widgetKey:ws.widgetKey,name:'Synthetic sensitive-data requester',email:'synthetic-happytohelp-1@example.test'}})
 const ticket=await app.ok('/api/conversations',{token:person.token,headers,body:{projectId:ws.projectId}})
 const message=await app.ok(`/api/conversations/${ticket.id}/messages`,{token:person.token,headers,body:{content:'synthetic-happytohelp-1: fictional sensitive support text; no real health data.',localId:'opening',expectedRevision:0}})
 const initial=(await call()).data;assert.equal(initial.health_data_enabled,false);assert.equal(initial.readiness,'incomplete');assert.ok(initial.blockers.some(s=>s.includes('BAA')))
 assert.equal((await app.call(base,{token:ws.tokens.operator})).status,403)
 assert.equal((await app.call(base,{token:foreign.tokens.owner})).status,403)
 const config={partner:'US qualification partner',deployment_ref:'synthetic-happytohelp-1-isolated-deployment',timezone:'America/New_York',country:'US',currency:'USD',recording_enabled:false}
 for(const change of [{timezone:'EST'},{country:'EU'},{currency:'EUR'},{recording_enabled:true}])assert.equal((await app.call(base,{token,method:'PUT',body:{...config,...change}})).status,400)
 assert.equal((await app.call(base,{token:ws.tokens.operator,method:'PUT',body:config})).status,403)
 assert.equal((await app.call(base,{method:'PUT',body:config,headers:{Cookie:'h2h_session='+token,Origin:'https://foreign.example'}})).status,403)
 await call('',config,{method:'PUT'})
 const held=(await call()).data;assert.equal(held.profile.country,'US');assert.equal(held.profile.currency,'USD');assert.equal(held.profile.timezone,'America/New_York');assert.equal(held.recording_enabled,false)
 for(const [path,auth,body] of [[`/api/conversations/${ticket.id}`,token],[`/api/conversations/${ticket.id}/messages`,person.token],[`/api/dashboard/projects/${ws.projectId}/conversations/${ticket.id}`,token],['/api/identity/widget/session',null,{widgetKey:ws.widgetKey,name:'Must stay blocked'}],['/api/conversations',token,{projectId:ws.projectId}],['/api/management/bootstrap?projectId='+ws.projectId+'&inbox=project',token]])assert.equal((await app.call(path,{token:auth,body,headers})).status,403,path)
 // Admin remediation remains available after the hold, including the shell read and native retention policy.
 assert.equal((await app.call('/api/management/bootstrap?projectId='+ws.projectId,{token})).status,200)
 await app.ok(`/api/management/projects/${ws.projectId}/audit/retention`,{token,method:'PUT',body:{days:365}})
 const now=Date.now(),date=offset=>new Date(now+offset).toISOString()
 const add=async(kind,extra={})=>call('/evidence',{kind,provider:'US provider / independent verifier',reference:'https://evidence.example.test/synthetic-happytohelp-1/'+kind,status:['dpa','baa'].includes(kind)?'executed':kind==='subprocessor'?'approved':'passed',valid_from:date(-1000),expires_at:date(86400000),settings:{region:'US',model_training:false,baa_covered:true,retention_days:0},...extra})
 assert.equal((await app.call(base+'/evidence',{token,body:{kind:'subprocessor',provider:'Provider',reference:'https://evidence.example.test/provider',status:'approved',valid_from:date(-1000),expires_at:date(86400000),settings:{region:'US',model_training:true,baa_covered:true,retention_days:0}}})).status,400)
 const short=await add('dpa',{expires_at:new Date(Date.now()+700).toISOString()});assert.ok(short.id)
 await new Promise(resolve=>setTimeout(resolve,800))
 assert.ok((await call()).data.blockers.some(b=>b.includes('DPA')&&b.includes('expired')),'expiry is evaluated on the current request')
 const records=[];for(const kind of ['dpa','baa','subprocessor','tenant_isolation','permissions','audit','retention','recovery','erasure','export','incident_response','channel_consent'])records.push({kind,...await add(kind)})
 const ready=(await call()).data;assert.equal(ready.readiness,'ready_for_independent_review');assert.deepEqual(ready.blockers,[]);assert.equal(ready.health_data_enabled,false)
 const refused=await app.call(base+'/activate',{token,body:{health_data_enabled:true}});assert.equal(refused.status,409);assert.match(refused.data.error,/independent partner review/)
 // Reopening an ordinary data door is impossible even after all manually recorded evidence passes.
 assert.equal((await app.call('/api/conversations/'+ticket.id,{token})).status,403)
 const baa=records.find(r=>r.kind==='baa');await call('/evidence/'+baa.id+'/revoke',{})
 const revoked=(await call()).data;assert.equal(revoked.health_data_enabled,false);assert.ok(revoked.blockers.some(b=>b.includes('BAA')))
 const report=await app.call(base+'/report',{token});assert.equal(report.status,200);assert.match(report.headers.get('Content-Disposition'),/qualification.json/);assert.equal(report.data.data.health_data_enabled,false)
 assert.ok(!JSON.stringify(report.data).includes(message.message.content),'evidence exports contain references and control state, never support content')
 await app.ok(`/api/management/projects/${ws.projectId}/contacts/${person.contactId}/erase`,{token,body:{}})
 const erased=await app.first('SELECT content,erased_at FROM messages WHERE id=?',message.message.id);assert.equal(erased.content,'');assert.ok(erased.erased_at)
 assert.equal((await app.call(base,{token:foreign.tokens.owner})).status,403)
 await app.configure({})
 assert.ok((await call()).data.blockers.some(b=>b.includes('BAA')),'revocation survives restart')
 const audit=await app.ok(`/api/management/projects/${ws.projectId}/audit`,{token});assert.ok(audit.data.some(row=>row.action==='assurance.activation_refused'));assert.ok(audit.data.some(row=>row.action==='assurance.evidence_revoked'))
 assert.equal((await app.call(`/api/assurance/projects/${foreign.projectId}`,{token})).status,403)
 }finally{await app.close()}
}
