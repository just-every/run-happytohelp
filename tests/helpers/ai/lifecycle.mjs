import assert from 'node:assert/strict'
import {assistantApp} from './app.mjs'

// One generation per visitor turn: it is admitted only if nothing it depends on changed, a cancelled or
// interrupted attempt never replays the provider, and a missing provider key is visible without losing the message.
export async function lifecycleJourney(){
 const a=await assistantApp(),{app,ai,p,owner}=a
 // A new visitor turn and its queued generation job (other captured work, such as schedule recovery, is set aside).
 const ask=async(text='Question')=>{const v=await a.visitor();await v.say(text);const id=(await a.generations(v.conversationId)).at(-1).id,job=(await app.takeJobs()).find(job=>job.id===id);assert.equal(job?.type,'ai.generate');return {v,job}}
 const latest=async v=>(await a.generations(v.conversationId)).at(-1)
 const replies=async v=>(await v.transcript()).messages.filter(message=>message.actor_role==='ai')
 const trigger=(name,table,when,timing='BEFORE INSERT')=>app.db.prepare(`CREATE TRIGGER ${name} ${timing} ON ${table} WHEN ${when} BEGIN SELECT RAISE(ABORT,'Injected ${name}'); END`).run()
 const drop=name=>app.db.prepare(`DROP TRIGGER ${name}`).run()
 try{
  // A durable attempt marker precedes every provider request.
  ai.before=async()=>assert.ok((await app.first("SELECT COUNT(*) n FROM ai_attempt_events WHERE type='agent_start'")).n>=ai.calls.length,'attempt marker precedes provider dispatch')
  const done=await ask();await app.runJobs([done.job]);assert.equal((await latest(done.v)).state,'completed');assert.equal((await replies(done.v)).length,1)
  let calls=a.providerCalls();await app.runJobs([done.job]);assert.equal(a.providerCalls(),calls,'redelivery never repeats a completed generation')
  // Anything the answer depends on changing while the provider runs supersedes it: a new visitor message, the
  // assistant's instructions, a private note.
  for(const [label,change] of [
   ['visitor message',v=>v.say('Another detail')],
   ['instructions',()=>app.db.prepare("UPDATE ai_profiles SET prompt='Changed policy' WHERE id='ai'").run()],
   ['private note',v=>app.call(`/api/dashboard/projects/${p}/conversations/${v.conversationId}/notes`,{token:owner,body:{content:'New private fact'},status:201})],
  ]){
   const turn=await ask();ai.before=()=>{ai.before=null;return change(turn.v)};await app.runJobs([turn.job]);await app.takeJobs()
   assert.equal((await app.first('SELECT state FROM ai_generations WHERE id=?',turn.job.id)).state,'superseded',label);assert.equal((await replies(turn.v)).length,0,label)
   await app.db.prepare("UPDATE ai_profiles SET prompt='Use evidence' WHERE id='ai'").run()
  }
  // An operator cancels before execution: no provider call. Cancelled while the provider runs: usage kept, output not.
  const queued=await ask();calls=a.providerCalls()
  assert.equal((await app.call(`/api/ai-support/projects/${p}/generations/${queued.job.id}/cancel`,{token:owner,body:{},status:200})).data.cancelled,true)
  await app.runJobs([queued.job]);assert.equal((await latest(queued.v)).state,'cancelled');assert.equal(a.providerCalls(),calls)
  const running=await ask();ai.before=()=>{ai.before=null;return app.call(`/api/ai-support/projects/${p}/generations/${running.job.id}/cancel`,{token:owner,body:{},status:200})}
  ai.respond=()=>'Generated reply that quotes the erased customer';await app.runJobs([running.job])
  const cancelled=await latest(running.v);assert.equal(cancelled.state,'cancelled');assert.ok(!String(cancelled.output_json).includes('quotes the erased customer'),'provider output is not retained')
  assert.ok(JSON.parse(cancelled.output_json).usage,'usage is kept');assert.equal((await replies(running.v)).length,0);ai.respond=()=>'Reply'
  // A disabled assistant, or a conversation handed to a person, is never answered; a person's explicit request is refused there.
  const disabled=await ask();await app.db.prepare("UPDATE ai_profiles SET is_enabled=0 WHERE id='ai'").run();calls=a.providerCalls()
  await app.runJobs([disabled.job]);assert.equal((await latest(disabled.v)).state,'superseded');assert.equal(a.providerCalls(),calls)
  await app.db.prepare("UPDATE ai_profiles SET is_enabled=1 WHERE id='ai'").run()
  const human=await ask();assert.equal((await a.action(human.v.conversationId,'assignAi',{ai_id:null})).status,200);await app.takeJobs()
  await app.runJobs([human.job]);assert.ok(['cancelled','superseded'].includes((await latest(human.v)).state),'a handed-over turn is withdrawn');assert.equal(a.providerCalls(),calls)
  assert.ok((await a.action(human.v.conversationId,'request',{requestId:crypto.randomUUID()})).status>=400,'no explicit assistant request in a human conversation')
  // The process dies after the answer is admitted but before its attempt is closed: delivery or the schedule
  // completes it without calling the provider, keeping the exact paid usage.
  for(const recover of ['delivery','scheduled']){
   const crash=await ask();await trigger('attempt_crash','ai_attempts',`NEW.state='completed' AND OLD.generation_id='${crash.job.id}'`,'BEFORE UPDATE')
   await app.runJobs([crash.job]);await drop('attempt_crash')
   assert.equal((await latest(crash.v)).state,'completed');assert.equal((await replies(crash.v)).length,1);calls=a.providerCalls()
   const usage=await app.sql('SELECT u.usage_json FROM ai_round_usage u JOIN ai_attempts t ON t.id=u.attempt_id WHERE t.generation_id=?',crash.job.id)
   if(recover==='delivery'){await app.runJobs([crash.job]);await app.runJobs([crash.job])}else{await app.scheduled();await app.scheduled()}
   assert.equal(a.providerCalls(),calls,'recovery never calls the provider');assert.equal((await app.first('SELECT state FROM ai_attempts WHERE generation_id=?',crash.job.id)).state,'completed',recover)
   assert.deepEqual(await app.sql('SELECT u.usage_json FROM ai_round_usage u JOIN ai_attempts t ON t.id=u.attempt_id WHERE t.generation_id=?',crash.job.id),usage);assert.equal((await replies(crash.v)).length,1)
  }
  // An attempt whose process died before any admission is uncertain and never replayed.
  const ambiguous=await ask();await app.db.prepare("UPDATE ai_generations SET state='running' WHERE id=?").bind(ambiguous.job.id).run();calls=a.providerCalls()
  await app.runJobs([ambiguous.job]);await app.runJobs([ambiguous.job]);assert.equal((await latest(ambiguous.v)).state,'uncertain');assert.equal(a.providerCalls(),calls)
  // A notification failing after admission cannot undo the answer or replay the provider.
  const effect=await ask();await trigger('notify_outage','operator_notifications','1=1');calls=a.providerCalls()
  await app.runJobs([effect.job]);await drop('notify_outage')
  assert.equal((await latest(effect.v)).state,'completed');assert.equal((await replies(effect.v)).length,1);assert.equal(a.providerCalls(),calls+1)
  await app.runJobs([effect.job]);assert.equal(a.providerCalls(),calls+1,'a post-commit failure never replays the provider')
  // A key removed after the assistant took the conversation: the visitor's message is kept and the missing
  // configuration is visible. (New conversations are not given an assistant without a key.)
  const unconfigured=await a.visitor();await app.configure({OPENAI_API_KEY:undefined});calls=a.providerCalls()
  await unconfigured.say('Anyone there?');await unconfigured.say('Hello?');await a.run()
  const failed=(await a.generations(unconfigured.conversationId)).at(-1);assert.equal(failed.state,'failed');assert.match(failed.error,/CONFIGURATION_REQUIRED: OPENAI_API_KEY/)
  assert.equal((await unconfigured.transcript()).messages.length,2);assert.equal(a.providerCalls(),calls)
  // Usage is recorded per provider round; AI execution and recovery never create billing records.
  assert.equal(JSON.parse((await app.first('SELECT usage_json FROM ai_round_usage WHERE usage_json IS NOT NULL')).usage_json).input_tokens,5)
  for(const table of ['billing_accounts','billing_usage_receipts','billing_ledger'])assert.equal((await app.first(`SELECT COUNT(*) n FROM ${table}`)).n,0,table)
 }finally{await a.close()}
}
