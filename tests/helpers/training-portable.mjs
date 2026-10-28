import assert from 'node:assert/strict';
import {archiveStorage} from './rer-archive.mjs';

export async function seedPortableTraining(origin,projectId,token){
 const ids=[];
 for(const status of ['planning','queued','running','completed']){
  const response=await fetch(`${origin}/api/training/projects/${projectId}/runs`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({request_id:'synthetic-happytohelp-'+status,kind:'evaluation',cases:[{id:'retained-case',messages:[{role:'contact',content:'Where is the parcel?'}]}],models:['synthetic-happytohelp-1'],max_cost:1,max_tokens:100})});
  assert.equal(response.status,201,await response.clone().text());
  ids.push({id:(await response.json()).data.id,status});
 }
 return {projectId,ids};
}

// A stopped process boundary represents interrupted provider work. Creation is
// through the public route; only the lost process's completion/claim is seeded.
export async function interruptPortableTraining(root,state){
 await archiveStorage(root,async({DB})=>{
  for(const {id,status} of state.ids){
   await DB.prepare('UPDATE training_runs SET status=?,spent_cost=?,reserved_cost=? WHERE id=?').bind(status,status==='completed'?.125:0,status==='running'?.25:0,id).run();
   await DB.prepare('UPDATE training_cases SET status=?,attempt_id=?,usage=?,checks=?,lease_expires_at=? WHERE run_id=?').bind(status==='planning'?'queued':status,status==='running'||status==='completed'?'synthetic-happytohelp-'+status:null,status==='completed'?'{"input_tokens":150}':null,status==='completed'?'{"passed":true}':null,status==='running'?Date.now()+900000:null,id).run();
  }
 });
}

export async function verifyPortableTraining(origin,state,token){
 for(const {id,status} of state.ids){
  const response=await fetch(`${origin}/api/training/projects/${state.projectId}/runs/${id}`,{headers:{Authorization:'Bearer '+token}});
  assert.equal(response.status,200);const {data}=await response.json();
  assert.equal(data.status,status==='running'?'uncertain':status==='completed'?'completed':'cancelled');
  assert.equal(data.cases[0].status,data.status);
  assert.equal(data.reserved_cost,status==='running'?.25:0);
  assert.equal(data.spent_cost,status==='completed'?.125:0);
  if(status==='completed')assert.equal(data.cases[0].checks.passed,true);
  else assert.equal(data.cases[0].lease_expires_at,null);
 }
}
