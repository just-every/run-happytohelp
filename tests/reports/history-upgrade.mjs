import assert from 'node:assert/strict';

// One historical workspace, upgraded once. Old assisted work belongs to its old
// cycle; a visible AI answer and an insight-button exchange are retained as data.
export async function seedHistoryUpgrade(storage){
 const sql=(sql,values=[])=>storage.inspect({sql,values});
 await sql("INSERT INTO conversations(id,project_id,contact_id,revision,created_at,updated_at,resolved_at) VALUES('old-assisted','upgrade-project','upgrade-contact',3,1,900,900),('old-visible','upgrade-project','upgrade-contact',2,1000,8000,8000),('old-insight','upgrade-project','upgrade-contact',3,1,30,NULL)");
 await sql(`INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at) VALUES
 ('old-assisted-answer','upgrade-project','old-assisted','a','upgrade-agent','owner','Old assisted answer',1,2),
 ('old-assisted-reopen','upgrade-project','old-assisted','v','upgrade-contact','contact','Later question',2,800),
 ('old-assisted-unknown','upgrade-project','old-assisted','r','upgrade-agent','owner','Unknown newer answer',3,850),
 ('visible-question','upgrade-project','old-visible','question','upgrade-contact','contact','Question',1,2000),
 ('visible-answer','upgrade-project','old-visible','answer','historic-ai','ai','Persisted visible answer',2,7000),
 ('insight-question','upgrade-project','old-insight','v','upgrade-contact','contact','Hello',1,10),
 ('insight-display','upgrade-project','old-insight','display','ai','ai','Need help?',2,20),
 ('insight-button','upgrade-project','old-insight','button','upgrade-contact','contact','Yes please',3,20)`);
 await sql("INSERT INTO local_devices(id,user_id,project_id,token_hash,name,provider,capabilities) VALUES('old-device','upgrade-agent','upgrade-project','old-device-digest','Old','codex','[]')");
 await sql("INSERT INTO local_jobs(id,project_id,conversation_id,operator_id,device_id,request_id,mode,instructions,status,created_at) VALUES('old-job','upgrade-project','old-assisted','upgrade-agent','old-device','old-request','resolve','Historical','completed','2026-01-01')");
 await sql("INSERT INTO local_receipts(job_id,proposal_id,kind,status,message_id) VALUES('old-job','legacy','reply','sent','old-assisted-answer')");
 await sql(`INSERT INTO context_insights(id,project_id,subject_id,help_type,content,buttons,evidence_ids,created_at) VALUES('old-insight-row','upgrade-project','upgrade-contact','help','Need help?','[{"text":"Yes please"}]','[]',10)`);
}

export async function verifyHistoryUpgrade(runtime,token){
 const request=async(path,body,method=body===undefined?'GET':'POST')=>{
  const response=await fetch(runtime.origin+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  assert.equal(response.status,200,`${method} ${path}`);return response.json();
 };
 const messages=id=>request(`/api/conversations/${id}/messages`);
 for(const id of ['upgrade-closed','old-assisted','old-visible'])assert.equal((await messages(id)).resolution.outcome,'unknown','old history never invents a confirmed resolution');
 const insight=await messages('old-insight');assert.ok(insight.messages.some(row=>row.content==='Need help?'));assert.ok(insight.messages.some(row=>row.content==='Yes please'));
 const report=await request('/api/dashboard/projects/upgrade-project/reports?period=custom&start=1970-01-01&end=1970-01-02');
 assert.equal(report.volume,5);assert.equal(report.aiResolution.count,0);assert.equal(report.firstResolution.count,0);assert.equal(report.satisfaction.total,0);
 assert.deepEqual(report.firstResponse,{count:2,median:(50+5000)/2,p90:5000},'the reopened customer reply and visible AI answer count; the insight display does not');
 // A new native human answer establishes its own cycle without borrowing the
 // old assisted receipt or retroactively inventing the first resolution time.
 await request('/api/dashboard/projects/upgrade-project/conversations/old-assisted',{resolved:false},'PUT');
 const prior=await messages('old-assisted');
 await request('/api/conversations/old-assisted/messages',{localId:'after-upgrade-human',content:'Confirmed new human answer',expectedRevision:prior.revision,expectedLastMessageId:prior.lastMessageId,authoring:{kind:'human'},resolve:true});
 assert.equal((await messages('old-assisted')).resolution.outcome,'human');
 assert.equal((await request('/api/dashboard/projects/upgrade-project/reports?period=custom&start=1970-01-01&end=1970-01-02')).firstResolution.count,0);
}
