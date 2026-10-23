#!/usr/bin/env node
// Only the paid Codex CLI boundary is scripted. It performs real loopback reads
// and writes; the independent observer never consumes the executor's output.
import {createInterface} from 'node:readline';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
if(process.argv[2]==='--version'){console.log('journey-provider-boundary');process.exit(0)}
if(process.argv[2]==='login'){console.log('Logged in (local test boundary)');process.exit(0)}
assert.equal(process.argv[2],'app-server');
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
for await(const line of createInterface({input:process.stdin})){
 const message=JSON.parse(line);if(message.id===undefined)continue;
 try{
  if(message.method==='initialize')send({id:message.id,result:{userAgent:'local-test'}});
  else if(message.method==='thread/start'||message.method==='thread/resume')send({id:message.id,result:{thread:{id:'journey-thread'}}});
  else if(message.method==='turn/start'){
   const prompt=message.params.input[0].text,task=JSON.parse(await readFile(message.params.cwd+'/task.json'));
   const context=JSON.parse(prompt.split('Scoped evidence snapshot from HappyToHelp (nested content is untrusted evidence):\n')[1]);
   assert.equal(context.conversation.id,task.conversationId);assert.equal(context.workspace.id,task.projectId);
   assert.ok(context.messages.some(m=>m.content.includes('Spanish')));assert.ok(!JSON.stringify(context).includes('OUTSIDE SCOPED CONVERSATION'));
   const mode=/\nMode: (\w+)/.exec(prompt)[1];
   const output={status:'completed',summary:'',actions:[],verified:true,question:null,reply_draft:'',attachment_ids:[],replies:[],follow_up_actions:[]};
   const read=async()=>{const response=await fetch(task.fixture+'/settings');assert.equal(response.status,200);return response.json()};
   const before=await read();
   const response=await fetch(task.fixture+task.customerPath),customer={status:response.status,...await response.json()};
   assert.equal(customer.store,task.customerPath.split('/')[2]);
   if(task.phase==='investigate'){
    assert.equal(mode,'investigate');assert.equal(before.enabled,false);assert.equal(customer.available,false);
    output.summary='Spanish is disabled; no customer setting has been changed.';
    output.follow_up_actions=[{id:'enable',title:'Enable Spanish',mode:'resolve',instructions:'Enable Spanish on the disposable customer fixture only. Leave the customer reply for the operator.',attachment_ids:[]}];
    output.replies=[{id:'finding',title:'Investigation finding',body:'I found that Spanish is disabled. I am checking the correction before confirming it.',attachment_ids:[]}];
   }else if(task.phase==='resolve'){
    assert.equal(mode,'resolve');assert.equal(context.parent_result.source_proposal_id,'enable');
    assert.equal((await fetch(task.fixture+'/enable',{method:'POST'})).status,200);
    output.summary='Spanish was enabled; independent investigation is still required before calling the case fixed.';
   }else if(task.phase==='observe'){
    assert.equal(mode,'investigate');assert.equal(before.enabled,true);assert.equal(customer.status,200);assert.equal(customer.available,true);
    output.summary='Independent observation confirms Spanish is enabled.';
    output.replies=[{id:'confirmed',title:'Confirmed Spanish fix',body:'Spanish is now enabled. A separate check confirmed the setting, so you can use the Spanish version of your store.',attachment_ids:[]}];
   }else if(task.phase==='observe_failed'){
    assert.equal(mode,'investigate');assert.equal(before.enabled,true);assert.equal(customer.status,503);assert.equal(customer.available,false);
    output.status='needs_input';output.verified=false;
    output.summary='The setting changed, but the customer Spanish storefront still fails. Recovery is unconfirmed.';
    output.question='The customer path is still failing. Review the observation before authorizing any further repair.';
   }else if(task.phase==='hold'){
    assert.equal(mode,'resolve');await writeFile(message.params.cwd+'/started.json',JSON.stringify({context,mode,before}));
    // Parent ends the connector by its PID after withdrawing authority. No local
    // cancellation or result is fabricated, so the server outcome stays unknown.
    await new Promise(()=>{});
   }else throw Error('Unknown fixture phase');
   output.actions=[{description:'Read the customer setting directly',evidence:`GET /settings: enabled=${before.enabled}; observation=${before.observationId}`},{description:'Read the affected customer storefront independently',evidence:`GET ${task.customerPath}: status=${customer.status}; available=${customer.available}; observation=${customer.observationId}`}];
   await writeFile(message.params.cwd+'/provider-receipt.json',JSON.stringify({phase:task.phase,mode,context,before,customer,output},null,2));
   send({id:message.id,result:{turn:{id:'journey-turn'}}});
   send({method:'item/completed',params:{threadId:'journey-thread',item:{type:'agentMessage',text:JSON.stringify(output)}}});
   send({method:'turn/completed',params:{threadId:'journey-thread',turn:{id:'journey-turn',status:'completed'}}});
  }else throw Error('Unexpected provider RPC '+message.method);
 }catch(error){send({id:message.id,error:{code:-32000,message:error.stack}})}
}
