import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {applyMigrations} from '../journeys/kit/app.mjs';
import {expectedSchema} from './upgrade-schema-expectations.mjs';
import {selfServiceFixture} from './self-service-fixture.mjs';
// A valid expired signature, using only the fixture's signing key and clock state.
// The HTTP door must refuse it for expiry, independently of signature refusal.
export function expiredSurveyPath(row,key){
 const surface=row.channel,parts=['csat-v1',row.id,row.project_id,row.resolution_id,row.contact_id,row.recipient,row.expires_at,row.token_revision,surface];
 return '/api/outcomes/surveys/'+row.id+'.'+row.token_revision+'.'+surface+'.'+createHmac('sha256',key).update(JSON.stringify(parts)).digest('hex');
}
const link=text=>text.match(/\/api\/outcomes\/surveys\/[a-zA-Z0-9.-]+/)[0];
export async function emailOutcomes(){
 await surveyUpgrade();
 const f=await selfServiceFixture(),{app,p,owner,mail}=f,root=`/api/outcomes/projects/${p}`,settings={enabled:true,scale:'five',locale:'en',delayMinutes:0,expiresDays:1};
 const configure=value=>app.ok(root+'/settings',{...owner,method:'PUT',body:value});
 const resolve=id=>app.ok(`/api/dashboard/projects/${p}/conversations/${id}`,{...owner,method:'PUT',body:{resolved:true}});
 let sequence=0;
 const create=async(email='survey-'+sequence+'@example.com')=>{const incoming=await app.ok('/api/integrations/email/inbound',{headers:{Authorization:'Bearer fixture-survey-signing-key-for-self-service'},body:{messageId:'email-outcomes-'+sequence++,to:'help@example.com',from:email,subject:'Support question',text:'Please help with this order.'}});await resolve(incoming.conversationId);return incoming.conversationId};
 const row=id=>app.first('SELECT * FROM csat_surveys WHERE conversation_id=? ORDER BY created_at DESC',id);
 const invites=()=>mail.filter(m=>m.text.includes('/api/outcomes/surveys/'));
 try{
  for(const change of [{enabled:'true'},{scale:'ten'},{locale:'xx'},{delayMinutes:-1},{delayMinutes:1.5},{delayMinutes:43201},{expiresDays:0},{expiresDays:91},{widgetEnabled:'true'}])assert.equal((await app.call(root+'/settings',{...owner,method:'PUT',body:{...settings,...change}})).status,400);
  await configure(settings);const id=await create(),before=invites().length;await app.scheduled();await app.scheduled();assert.equal(invites().length,before+1);
  const survey=await row(id),path=link(invites().at(-1).text);assert.equal(survey.expires_at-survey.due_at,86400000);
  await configure({...settings,scale:'thumbs',locale:'fr',delayMinutes:60,expiresDays:2});assert.equal((await row(id)).scale,'five');assert.equal((await row(id)).locale,'en');
  assert.equal((await app.call(path)).status,200);const answer=await app.call(path,{body:{score:1,comment:'email private original',recovery:'not_recovered'}});assert.equal(answer.status,200);assert.equal((await app.call(path,{body:{score:5}})).status,410);
  const changed=await app.call(link(answer.data),{body:{score:2,comment:'email private revised',recovery:'recovered'}});assert.equal(changed.status,200);
  const result=(await app.ok(root+'/results?lowScore=true',owner)).results.find(r=>r.conversationId===id);assert.equal(result.response.channel,'email');assert.equal(result.response.revision,2);assert.equal(result.response.recovery,'recovered');assert.equal((await app.ok('/api/conversations/'+id,owner)).status_category,'solved');
  assert.equal((await app.first('SELECT count(*) n FROM csat_response_history WHERE resolution_id=?',survey.resolution_id)).n,2);
  await app.ok(root+'/surveys/'+survey.id+'/revoke',{...owner,body:{}});assert.equal((await app.call(link(changed.data))).status,410);
  await configure(settings);const expiryId=await create();await app.scheduled();const expired=await row(expiryId);expired.expires_at=Date.now()-1;
  await app.db.prepare('UPDATE csat_surveys SET expires_at=? WHERE id=?').bind(expired.expires_at,expired.id).run();assert.equal((await app.call(expiredSurveyPath(expired,'fixture-survey-signing-key-for-self-service'),{body:{score:1}})).status,410);
  const stopId=await create(),count=invites().length;await app.scheduled();const stop=link(invites().at(-1).text);await app.ok(stop+'/optout',{body:{}});assert.equal((await app.call(stop)).status,410);await app.scheduled();assert.equal(invites().length,count+1);
  const stopped=await row(stopId),stopContact=stopped.contact_id;assert.ok(await app.first('SELECT 1 FROM csat_optouts WHERE contact_id=?',stopContact));
  await create(stopped.recipient);await app.scheduled();assert.equal(invites().length,count+1,'email opt-out prevents invitations to later support cycles');
  await configure({...settings,delayMinutes:60});const pendingId=await create('preference@example.com');await app.scheduled();const pending=await row(pendingId);assert.equal(pending.state,'pending');
  const portal=await f.signin('preference@example.com');await app.ok(`/api/portal/${p}/preferences`,{...portal,method:'PUT',body:{locale:'en',surveyEmails:false,updateEmails:true}});assert.equal((await row(pendingId)).state,'cancelled');
  const pendingCount=invites().length;await app.scheduled();assert.equal(invites().length,pendingCount);
  await configure({...settings,enabled:false});assert.equal((await app.call(link(changed.data))).status,410);
  await app.ok(`/api/dashboard/projects/${p}/conversations/${id}`,{...owner,method:'PUT',body:{resolved:false}});
  assert.equal((await app.ok(`/api/dashboard/projects/${p}/conversations/${id}`,owner)).data.resolutionHistory[0].rating.comment,'email private revised');
  assert.ok((await app.call(root+'/results?format=csv',owner)).data.includes('email private revised'));
  await app.ok(`/api/management/projects/${p}/contacts/${survey.contact_id}/erase`,{...owner,body:{}});
  const erased=(await app.ok(root+'/results',owner)).results.find(r=>r.conversationId===id);assert.equal(erased.response.comment,'');assert.equal((await app.call(link(changed.data))).status,404,'erasure removes the recipient bound into the signature');
  assert.ok(!(await app.call(root+'/results?format=csv',owner)).data.includes('email private'));
  assert.ok((await app.ok(`/api/dashboard/projects/${p}/conversations/${id}`,owner)).data.resolutionHistory.every(r=>r.rating===null||r.rating.comment===''));
  for(const table of ['csat_responses','csat_response_history'])assert.ok((await app.sql(`SELECT comment FROM ${table} WHERE contact_id=?`,survey.contact_id)).every(r=>r.comment===''));
  assert.equal((await row(id)).recipient,'');
 }finally{await app.close();}
}

async function surveyUpgrade(){
 const f=await selfServiceFixture({migrate:name=>!name.startsWith('277_')}),{app,p,owner}=f;
 try{
  await app.ok(`/api/outcomes/projects/${p}/settings`,{...owner,method:'PUT',body:{enabled:true,scale:'five',locale:'en',delayMinutes:0,expiresDays:1}});
  const incoming=await app.ok('/api/integrations/email/inbound',{headers:{Authorization:'Bearer fixture-survey-signing-key-for-self-service'},body:{messageId:'pre-messaging-survey',to:'help@example.com',from:'prior@example.com',text:'Keep my existing response.'}});
  await app.ok(`/api/dashboard/projects/${p}/conversations/${incoming.conversationId}`,{...owner,method:'PUT',body:{resolved:true}});await app.scheduled();
  const path=link(f.mail.find(m=>m.text.includes('/api/outcomes/surveys/')).text);await app.ok(path,{body:{score:2,comment:'retained upgrade comment',recovery:'not_recovered'}});
  const schema=async()=>Object.fromEntries((await app.sql("SELECT name,type,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'")).map(({name,...entry})=>[name,entry]));
  const before=await schema(),tables=['csat_surveys','csat_responses','csat_response_history'],rows=await Promise.all(tables.map(table=>app.sql(`SELECT * FROM ${table}`)));
  await applyMigrations(app.db,name=>name==='277_messaging_surveys.sql');
  assert.deepEqual(expectedSchema(before,await schema(),['277_messaging_surveys.sql']),[]);
  for(const [index,table] of tables.entries())assert.deepEqual(await app.sql(`SELECT * FROM ${table}`),rows[index],table+' preserves every prior column and row');
  const response=(await app.ok(`/api/outcomes/projects/${p}/results`,owner)).results.find(r=>r.conversationId===incoming.conversationId).response;
  assert.equal(response.comment,'retained upgrade comment');assert.equal(response.channel,'email');assert.equal(response.recovery,'not_recovered');
 }finally{await app.close();}
}
