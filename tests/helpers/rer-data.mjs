import {seedPortableBusiness,verifyPortableBusiness} from './business-portable.mjs';
import assert from 'node:assert/strict';
import {WebSocket} from 'ws';
import {generate} from '../move-in/generator.mjs';
import {customer,history} from '../move-in/helpscout-fixtures.mjs';
import {seedReportsPortable,verifyReportsPortable} from './reports-portable.mjs';
import {seedPortableTraining,verifyPortableTraining} from './training-portable.mjs';
import {seedRecoveryTicket,verifyRecoveryTicket} from './recovery/tickets.mjs';

export async function seedImportHistory(origin,projectId,token,json){
 const base=`/api/move-in/projects/${projectId}/imports`;
 const upload=async(body,status=201)=>{
  const response=await fetch(origin+base+'?vendor=helpscout',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/octet-stream','X-Import-Filename':'archive-history.jsonl'},body});
  assert.equal(response.status,status);return response.json();
 };
 const wait=async(id,state)=>{for(let i=0;i<240;i++){const run=(await json(base+'/'+id,undefined,token)).data;if(run.state===state)return run;assert.equal(run.error,null);await new Promise(resolve=>setTimeout(resolve,250))}assert.fail(`Import did not reach ${state}`)};
 const apply=async body=>{const {data:uploaded}=await upload(body),ready=await wait(uploaded.id,'ready');assert.equal(ready.plan.counts.rejected,0);await json(base+'/'+ready.id+'/apply',{fingerprint:ready.plan.fingerprint},token);return wait(ready.id,'completed')};
 const completedBody=generate('helpscout',1),completed=await apply(completedBody);
 const repeat=await upload(completedBody,200);assert.equal(repeat.alreadyImported,true);assert.equal(repeat.writes,0);assert.equal(repeat.data.id,completed.id);
 // Disjoint source identities keep erasure and undo from altering retained history.
 const bodyFor=(id,contact)=>{const record=history(id,contact);record.conversation.tags=[];return [customer(contact,`person${contact}@example.test`),record.conversation,record.page].map(JSON.stringify).join('\n')};
 const undone=await apply(bodyFor(20002,1002));await json(base+'/'+undone.id+'/undo',{},token);await wait(undone.id,'undone');
 const erasedBody=bodyFor(20003,1003),erased=await apply(erasedBody);
 const contacts=(await json(`/api/management/projects/${projectId}/contacts`,undefined,token)).data;
 const contact=contacts.find(row=>row.email==='person1003@example.test');assert.ok(contact);
 await json(`/api/management/projects/${projectId}/contacts/${contact.id}/erase`,{},token);await wait(erased.id,'erased');
 return {completedId:completed.id,undoneId:undone.id,erasedId:erased.id,erasedContactId:contact.id,completedBody,erasedBody};
}

export async function verifyImportHistory(origin,projectId,state,token,json){
 const base=`/api/move-in/projects/${projectId}/imports`;
 for(const [id,expected] of [[state.completedId,'completed'],[state.undoneId,'undone'],[state.erasedId,'erased']])assert.equal((await json(base+'/'+id,undefined,token)).data.state,expected);
 const contact=(await json(`/api/management/projects/${projectId}/contacts/${state.erasedContactId}`,undefined,token)).data;
 assert.equal(contact.email,null);assert.equal(JSON.parse(contact.metadata_json).is_erased,1);
 const upload=body=>fetch(origin+base+'?vendor=helpscout',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/octet-stream','X-Import-Filename':'restored-history.jsonl'},body});
 const repeat=await upload(state.completedBody);assert.equal(repeat.status,200);const result=await repeat.json();assert.equal(result.alreadyImported,true);assert.equal(result.writes,0);assert.equal(result.data.id,state.completedId);
 for(const body of [state.erasedBody,'\n'+state.erasedBody,state.erasedBody.replaceAll('person1003@example.test','changed-after-restore@example.test')]){
  const replay=await upload(body);assert.equal(replay.status,410);await replay.arrayBuffer();
 }
}

export async function seedPortableData(origin,projectId,token,json){
 const project=await json(`/api/identity/projects/${projectId}`,undefined,token);
 const visitor=await json('/api/identity/widget/session',{widgetKey:project.widget_key,name:'Erase archive contact',email:'erase-archive@example.test'});
 const conversation=await json('/api/conversations',{projectId},visitor.token);
 await json(`/api/conversations/${conversation.id}/messages`,{localId:'archive-erasure',content:'Erase this message before backup',expectedRevision:0},visitor.token);
 await json(`/api/management/projects/${projectId}/contacts/${visitor.contactId}/erase`,{},token);
 const kept=await json('/api/identity/widget/session',{widgetKey:project.widget_key,name:'Retained archive contact'});
 const retained=await json('/api/conversations',{projectId},kept.token);
 await json(`/api/conversations/${retained.id}/messages`,{localId:'archive-search',content:'The retained cobalt parcel label',expectedRevision:0},kept.token);
 const bytes=Uint8Array.from([0,255,128,42,13,10]);
 const upload=await fetch(origin+`/api/conversations/${retained.id}/media`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/octet-stream','X-Filename':'retained.bin'},body:bytes});assert.equal(upload.status,201);const media=await upload.json();
 const imports=await seedImportHistory(origin,projectId,token,json);
 // Presence-based away settings travel with the workspace; who has the dashboard open is recorded, and never travels.
 const availability=await fetch(origin+`/api/management/projects/${projectId}/availability`,{method:'PUT',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({presence_idle_minutes:30,presence_away_message:'Back soon from the workshop.'})});assert.equal(availability.status,200,await availability.text());
 const stream=new WebSocket(`${origin.replace(/^http/,'ws')}/api/projects/${projectId}/socket?token=${token}`);await new Promise((resolve,reject)=>{stream.once('open',resolve);stream.once('error',reject)});
 stream.send(JSON.stringify({type:'presence',idleMs:0}));
 const online=async()=>(await json(`/api/management/projects/${projectId}/presence`,undefined,token)).data.online.length;
 for(let attempt=0;attempt<40&&!await online();attempt++)await new Promise(resolve=>setTimeout(resolve,250));
 assert.equal(await online(),1,'the owner\'s open dashboard is online');stream.close();
 const reports=await seedReportsPortable(origin,projectId,kept.contactId,retained.id,kept.token,token);
 const business=await seedPortableBusiness(origin,projectId,kept.contactId,token);
 const training=await seedPortableTraining(origin,projectId,token);
 const ticket=await seedRecoveryTicket({origin},{projectId,token},retained);
 const workProjectId=(await json('/api/management/projects',{name:'Archived work workspace',allowedOrigin:origin},token)).id;
 return {projectId,workProjectId,erasedContactId:visitor.contactId,conversationId:retained.id,mediaId:media.id,bytes:[...bytes],imports,reports,training,ticket,business};
}
export async function verifyPortableData(origin,state,token,json){
 assert.ok((await json('/api/management/projects',undefined,token)).data.some(project=>project.id===state.workProjectId),'the restored owner retains both workspaces');
 const contact=(await json(`/api/management/projects/${state.projectId}/contacts/${state.erasedContactId}`,undefined,token)).data;
 assert.equal(contact.email,null);assert.equal(JSON.parse(contact.metadata_json).is_erased,1);
 const settings=(await json(`/api/management/projects/${state.projectId}/settings`,undefined,token)).data;
 assert.deepEqual([settings.presence_idle_minutes,settings.presence_away_message],[30,'Back soon from the workshop.'],'presence-based away settings are restored');
 await verifyImportHistory(origin,state.projectId,state.imports,token,json);
 await verifyReportsPortable(origin,state.reports,token,json);
 await verifyPortableTraining(origin,state.training,token);
 await verifyPortableBusiness(origin,state.business,token);
 await verifyRecoveryTicket({origin},{owner:{projectId:state.projectId,token},conversation:{id:state.conversationId},ticket:state.ticket});
 const matches=await json(`/api/dashboard/projects/${state.projectId}/conversations?q=retained%20cobalt%20parcel`,undefined,token);
 assert.ok(matches.data.some(row=>row.id===state.conversationId),'restored messages are searchable after the derived index rebuild');
 const response=await fetch(origin+`/api/conversations/${state.conversationId}/media/${state.mediaId}`,{headers:{Authorization:`Bearer ${token}`}});assert.equal(response.status,200);assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],state.bytes);
}
