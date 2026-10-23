import assert from 'node:assert/strict';
import {archiveStorage} from '../rer-archive.mjs';

// Crash fixture: the provider accepted media and a command was durably claimed.
// Only stopped storage seeds this state; assertions use rer export/import and native reads.
export async function seedVoicePortable(root,state){
 await archiveStorage(root,async({DB})=>{
  const c=await DB.prepare('SELECT contact_id FROM conversations WHERE id=? AND project_id=?').bind(state.conversationId,state.projectId).first(),owner=await DB.prepare("SELECT user_id FROM memberships WHERE project_id=? AND role='owner' LIMIT 1").bind(state.projectId).first(),now=Date.now();
  await DB.batch([
   DB.prepare("INSERT INTO voice_numbers(id,project_id,provider,provider_id,account_id,phone,token_cipher,webhook_hash,settings_json,updated_at) VALUES('synthetic-happytohelp-40',?,'twilio','synthetic-happytohelp-41','synthetic-happytohelp-42','+12025550101','synthetic-happytohelp-43','synthetic-happytohelp-44','{}',?)").bind(state.projectId,now),
   DB.prepare("INSERT INTO voice_identities(project_id,phone_hash,contact_id,phone_cipher) VALUES(?,'synthetic-happytohelp-45',?,'synthetic-happytohelp-46')").bind(state.projectId,c.contact_id),
   DB.prepare("INSERT INTO voice_calls(id,project_id,number_id,conversation_id,contact_id,remote_cipher,direction,consent,recording_cipher,transcript,summary,created_at,updated_at,media_expires_at) VALUES('synthetic-happytohelp-47',?,'synthetic-happytohelp-40',?,?,'synthetic-happytohelp-48','inbound','granted','synthetic-happytohelp-49','synthetic-happytohelp-50','synthetic-happytohelp-51',?,?,?)").bind(state.projectId,state.conversationId,c.contact_id,now,now,now+86400000),
   DB.prepare("INSERT INTO voice_transcript_segments VALUES('synthetic-happytohelp-47',1,'inbound_track','synthetic-happytohelp-50','synthetic-happytohelp-52')"),
   DB.prepare("INSERT INTO voice_commands(id,project_id,conversation_id,number_id,call_id,kind,intent_hash,state,created_at,updated_at) VALUES('synthetic-happytohelp-53',?,?,'synthetic-happytohelp-40','synthetic-happytohelp-47','callback','synthetic-happytohelp-54','sending',?,?)").bind(state.projectId,state.conversationId,now,now),
   DB.prepare("INSERT INTO contacts(id,project_id,name,created_at) VALUES('synthetic-happytohelp-55',?,'Linked archive customer',?)").bind(state.projectId,now),
   DB.prepare("INSERT INTO voice_context_links VALUES(?,?,'synthetic-happytohelp-55',?,?)").bind(state.projectId,c.contact_id,owner.user_id,now),
  ]);
 });
}
export async function verifyVoicePortable(origin,state,token,json){
 const base=`/api/voice/projects/${state.projectId}`,root=base+`/conversations/${state.conversationId}`;
 const numbers=await json(base+'/numbers',undefined,token);assert.equal(numbers.data[0].connected,0);assert.equal(numbers.data[0].enabled,0);
 const history=await json(root+'/calls',undefined,token),call=history.data.find(c=>c.id==='synthetic-happytohelp-47');
 assert.equal(call.transcript,null);assert.equal(call.summary,'');assert.equal(call.has_recording,0);assert.equal(call.media_expires_at,0);
 assert.equal(history.commands[0].state,'uncertain');assert.equal(history.linked_context.id,'synthetic-happytohelp-55');
 assert.equal((await fetch(origin+root+'/calls/'+call.id+'/recording',{headers:{Authorization:'Bearer '+token}})).status,404);
 const command=await fetch(origin+root+'/commands',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({kind:'callback',call_id:call.id,number_id:call.number_id,request_id:'synthetic-happytohelp-56'})});assert.equal(command.status,404);await command.arrayBuffer();
}
