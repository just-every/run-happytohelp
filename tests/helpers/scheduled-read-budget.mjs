import assert from 'node:assert/strict'
import {startApp} from '../journeys/kit/app.mjs'

// A small team on Workers Free shares 5,000,000 D1 rows read a day across every
// tool on its account. The minute cron must stay far below that at defaults and
// must not read more as the workspace keeps more history.
const DAY=86400000,STEADY_CEILING=2_000,PAGE_CEILING=8_000

// Thirty days of support history: mostly solved conversations, each with a
// customer message and a reply, resolved, surveyed and announced to a webhook.
async function seedHistory(app,{projectId,users},{from,count,days=30}){
 const now=Date.now(),statements=[],closed=[]
 for(let n=from;n<from+count;n++){
  const created=now-Math.round((1-(n-from)/count)*days*DAY),id=`history-${n}`,contact=`history-contact-${n}`
  const open=n%20===0,resolved=open?null:created+2*3600000,status=open?'open':'solved'
  // A closed ticket is final, so older tickets close once their history is in place.
  if(!open&&created<=now-4*DAY)closed.push(id)
  statements.push(
   app.db.prepare("INSERT INTO contacts(id,project_id,name,email,created_at,metadata_json) VALUES(?,?,?,?,?,'{}')").bind(contact,projectId,`Customer ${n}`,`customer-${n}@example.test`,created),
   app.db.prepare('INSERT INTO conversations(id,project_id,contact_id,created_at,updated_at,status_id,status_category,subject,resolved_at,ticket_version) VALUES(?,?,?,?,?,?,?,?,?,1)').bind(id,projectId,contact,created,created+3600000,status,status,`Order question ${n}`,resolved))
  for(const [m,role] of [[0,'contact'],[1,'operator']]){
   const message=`${id}-m${m}`
   statements.push(
    app.db.prepare("INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at) VALUES(?,?,?,?,?,?,'Where is my order?',?,?)").bind(message,projectId,id,message,role==='contact'?contact:users.operator,role,m+1,created+m*60000),
    app.db.prepare('INSERT INTO conversation_outbox(project_id,conversation_id,message_id,created_at,delivered_at) VALUES(?,?,?,?,?)').bind(projectId,id,message,created+m*60000,created+m*60000+1000))
  }
  if(resolved){
   statements.push(
    app.db.prepare("INSERT INTO conversation_resolutions(id,project_id,conversation_id,contact_id,ordinal,resolved_at,resolved_revision,cycle_start_revision,outcome,evidence_json) VALUES(?,?,?,?,1,?,2,0,'human','{}')").bind(`resolution-${n}`,projectId,id,contact,resolved),
    app.db.prepare("INSERT INTO csat_surveys(id,project_id,resolution_id,conversation_id,contact_id,recipient,channel,scale,locale,due_at,expires_at,state,created_at,updated_at) VALUES(?,?,?,?,?,?,'email','five','en',?,?,'sent',?,?)").bind(`survey-${n}`,projectId,`resolution-${n}`,id,contact,`customer-${n}@example.test`,resolved+3600000,resolved+15*DAY,resolved,resolved))
  }
 }
 for(let i=0;i<statements.length;i+=200)await app.db.batch(statements.slice(i,i+200))
 // Every announcement was delivered long ago.
 await app.db.batch([
  app.db.prepare('UPDATE native_integration_intents SET prepared_at=? WHERE prepared_at IS NULL').bind(now),
  app.db.prepare("UPDATE conversations SET status_id='closed',status_category='closed' WHERE id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(closed)),
  app.db.prepare("INSERT OR IGNORE INTO integration_deliveries(namespace,id,fingerprint,destination_hash,envelope,state,attempts,created_at,next_at,max_attempts,retry_delays) SELECT project_id,id,'f','h','{}','accepted',1,?,?,5,'[]' FROM native_integration_intents").bind(now,now)])
}

// The scheduled invocation, repeated as the minute cron would run it.
async function minutes(app,count){
 const rows=[]
 for(let i=0;i<count;i++){const run=await app.scheduled();assert.equal(run.refused,0,'scheduled work stays inside its statement budget');rows.push(run.rowsRead)}
 return rows
}

export async function scheduledReadBudgetJourney(){
 const app=await startApp()
 try{
  const workspace=await app.seedWorkspace('history'),{projectId}=workspace,now=Date.now()
  const week=JSON.stringify([1,2,3,4,5].map(day=>({day,start:'09:00','end':'17:00'})))
  await app.db.batch([
   app.db.prepare("INSERT INTO workflow_calendars(project_id,id,name,timezone,weekly_json,holidays,closures_json,active,updated_at) VALUES(?,'hours','Business hours','UTC',?,'none','[]',1,?)").bind(projectId,week,now-31*DAY),
   app.db.prepare("INSERT INTO sla_policies(project_id,id,name,calendar_id,position,conditions_json,first_response_minutes,next_response_minutes,resolution_minutes,pause_on_hold,approaching_minutes,active,updated_at) VALUES(?,'standard','Standard','hours',0,'{}',60,120,1440,1,15,1,?)").bind(projectId,now-31*DAY),
   app.db.prepare("INSERT INTO native_integration_destinations(id,project_id,kind,name,mode,events_json,secret_ciphertext,enabled,created_at) VALUES('orders-hook',?,'webhook','Orders',NULL,?,'sealed',1,?)").bind(projectId,JSON.stringify(['conversation.created','message.created','conversation.resolved']),now-31*DAY),
   app.db.prepare("INSERT INTO csat_settings(project_id,enabled,scale,delay_minutes,expires_days,locale,enabled_at,updated_at) VALUES(?,1,'five',60,14,'en',?,?)").bind(projectId,now-31*DAY,now-31*DAY)])
  await seedHistory(app,workspace,{from:0,count:600})
  // The first minutes finish one SLA lap and one survey walk, a page at a time.
  const warm=await minutes(app,20)
  assert.ok(Math.max(...warm)<=PAGE_CEILING,`every scheduled page is bounded: ${warm}`)
  const small=await minutes(app,3)
  await seedHistory(app,workspace,{from:600,count:600})
  const large=await minutes(app,3)
  console.log(`Scheduled D1 rows read per run: 600 conversations ${small}; 1,200 conversations ${large}`)
  for(const [label,rows] of [['600',small],['1,200',large]])assert.ok(Math.max(...rows)<=STEADY_CEILING,`${label} conversations: a steady minute reads ${rows} rows`)
 }finally{await app.close()}
}
