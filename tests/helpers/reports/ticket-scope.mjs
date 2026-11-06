import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,relative,resolve} from 'node:path'
import {startApp,sha} from '../../journeys/kit/app.mjs'

/** Ordinary report/export cohort authority, within the existing calendar journey. */
export async function reportTicketScopeAssertions(){
 // A fixture D1 write between the first and second actual CSV queries makes
 // concurrency deterministic even when the HTTP transport reads ahead.
 const temporary=await mkdtemp(join(tmpdir(),'hh-report-scope-')),entry=join(temporary,'worker.ts')
 await writeFile(entry,`import worker from ${JSON.stringify(resolve('tests/journeys/kit/app-worker.ts'))}
 export {ConversationSocket} from ${JSON.stringify(resolve('tests/journeys/kit/app-worker.ts'))}
 export default {...worker,async fetch(request,env,context){
  const fixture=request.headers.get('x-test-report-scope'),clock=request.headers.get('x-test-report-now')
  if(clock){const original=Date.now;Date.now=()=>Number(clock);try{return await worker.fetch(request,env,context)}finally{Date.now=original}}
  if(!fixture)return worker.fetch(request,env,context)
  const {project,role,scope}=JSON.parse(fixture),db=env.DB;let pages=0
  const wrap=(statement,sql)=>new Proxy(statement,{get(target,key){
   if(key==='bind')return (...args)=>wrap(target.bind(...args),sql)
   if(key==='all')return async(...args)=>{
    const page=sql.includes('SELECT * FROM rows WHERE created_at>')?++pages:0
    if(page===2)await db.prepare('UPDATE project_roles SET ticket_scope_json=? WHERE project_id=? AND id=?').bind(JSON.stringify(scope),project,role).run()
    const result=await target.all(...args)
    if(page)await db.prepare('INSERT INTO synthetic_report_pages(page,rows) VALUES(?,?)').bind(page,result.results.length).run()
    return result
   }
   const value=target[key];return typeof value==='function'?value.bind(target):value
  }})
  const response=await worker.fetch(request,{...env,DB:{prepare:sql=>wrap(db.prepare(sql),sql),batch:db.batch.bind(db),exec:db.exec.bind(db),dump:db.dump.bind(db)}},context)
  const reader=response.body.getReader()
  return new Response(new ReadableStream({async pull(controller){try{const part=await reader.read();if(part.done)controller.close();else controller.enqueue(part.value)}catch(error){await db.prepare('INSERT INTO synthetic_report_stream_errors(status) VALUES(?)').bind(error.status||0).run();controller.error(error)}},async cancel(){await reader.cancel()}}),response)
 }}`)
 const sent=[],app=await startApp({entry:relative(process.cwd(),entry),captureQueue:true,bindings:{EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'synthetic-hh-69',EMAIL_FROM:'support@example.test'},outbound:async request=>{assert.equal(new URL(request.url).hostname,'api.resend.com');sent.push(await request.json());return Response.json({id:'synthetic-hh-mail-'+sent.length})}})
 const snapshot={},record=(point,input,output)=>console.log(`PROBE ACCESS-001 ${point}: ${input} -> ${JSON.stringify(output)}`)
 const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
 try{
  const w=await app.seedWorkspace('synthetic-hh-60'),q=await app.seedWorkspace('synthetic-hh-61'),p=w.projectId,P=`/api/management/projects/${p}`,D=`/api/dashboard/projects/${p}`
  const path=D+'/reports?period=custom&start=2026-03-07&end=2026-03-10',results=`/api/outcomes/projects/${p}/results`,brands=P+`/brands/reports?projects=${p},${q.projectId}&period=custom&start=2026-03-07&end=2026-03-10`
  const permissions=['reports.view','data.export','conversations.manage'],tokens={owner:w.tokens.owner,admin:w.tokens.admin},roles={}
  for(const [name,n] of [['all',62],['selected',63],['empty',64],['null',65]]){
   const id='synthetic-hh-'+n,token=id+'-session';tokens[name]=token
   await app.db.batch([
    app.db.prepare('INSERT INTO users(id,email,name,created_at) VALUES(?,?,?,1)').bind(id,id+'@example.test',id),
    app.db.prepare("INSERT INTO memberships VALUES(?,?,'admin')").bind(p,id),
    app.db.prepare("INSERT INTO sessions(token_hash,actor_id,project_id,role,expires_at) VALUES(?,?,?,'admin',?)").bind(sha(token),id,p,Date.now()+3600000),
    app.db.prepare("INSERT INTO session_factors(token_hash,user_id,method,verified_at) VALUES(?,?,'password',?)").bind(sha(token),id,Date.now()),
    app.db.prepare("INSERT INTO memberships VALUES(?,?,'admin')").bind(q.projectId,id),
   ])
   const role=await app.ok(P+'/roles',{token:w.tokens.owner,body:{name:'Synthetic report '+name,base:'admin',permissions}});roles[name]=role.data.id
   await app.ok(P+'/agents/'+id,{token:w.tokens.owner,method:'PUT',body:{role:role.data.id}})
  }
  for(const id of [w.users.owner,w.users.admin])await app.db.prepare("INSERT INTO memberships VALUES(?,?,'admin')").bind(q.projectId,id).run()
  tokens.foreign=q.tokens.owner
  const groups=['synthetic-hh-66','synthetic-hh-67']
  for(const id of groups)await app.db.prepare('INSERT INTO ticket_groups(id,project_id,name,updated_at) VALUES(?,?,?,1)').bind(id,p,id).run()
  const scope=(name,value)=>app.db.prepare('UPDATE project_roles SET ticket_scope_json=? WHERE project_id=? AND id=?').bind(value===null?null:JSON.stringify(value),p,roles[name]).run()
  const selected={groupIds:[groups[0]],includeUngrouped:false},empty={groupIds:[],includeUngrouped:false},all={groupIds:groups,includeUngrouped:true}
  await scope('all',all);await scope('selected',selected);await scope('empty',empty)
  // Every expected value comes from this fixture table, independently of report SQL.
  const rows=[['a',groups[0],1,10,1],['b',groups[1],3,20,-1],['c',groups[0],5,40,-1],['d',groups[1],7,80,1],['e',null,null,null,null]],at=Date.parse('2026-03-08T12:00:00Z'),contact='synthetic-hh-68'
  for(const project of [p,q.projectId])await app.db.prepare('INSERT INTO contacts(id,project_id,email,name,created_at) VALUES(?,?,?,?,1)').bind(project+'-customer',project,contact+'@example.test',contact).run()
  for(const [letter,group,response,resolution,rating] of rows){
   const id='synthetic-hh-'+letter,solved=resolution!==null,customer=p+'-customer'
   await app.db.batch([
    app.db.prepare('INSERT INTO conversations(id,project_id,contact_id,group_id,status_id,status_category,revision,created_at,updated_at,resolved_at) VALUES(?,?,?,?,?,?,2,?,?,?)').bind(id,p,customer,group,solved?'solved':'open',solved?'solved':'open',at,at,solved?at+resolution*1000:null),
    app.db.prepare("INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at) VALUES(?,?,?,?,?,'contact',?,1,?)").bind(id+'-question',p,id,id+'-question',customer,'synthetic-hh-question-'+letter,at),
    app.db.prepare('INSERT INTO conversation_tracking(conversation_id,project_id,initial_history_complete,cycle_history_complete,cycle_start_at,first_resolved_at) VALUES(?,?,1,1,?,?)').bind(id,p,at,solved?at+resolution*1000:null),
    app.db.prepare('INSERT INTO conversation_notes(id,conversation_id,user_id,content,created_at) VALUES(?,?,?,?,?)').bind(id+'-note',id,w.users.owner,'synthetic-hh-private-'+letter,at),
    app.db.prepare("INSERT INTO move_in_notes(id,project_id,conversation_id,author_json,content,created_at,source_time) VALUES(?,?,?,'{}',?,?,'2026-03-08T12:00:00Z')").bind(id+'-imported-note',p,id,'synthetic-hh-imported-private-'+letter,at),
    app.db.prepare("INSERT INTO media(id,project_id,conversation_id,uploaded_by,object_key,filename,content_type,size,message_id,created_at) VALUES(?,?,?,?,?,?,'text/plain',7,?,?)").bind(id+'-media',p,id,w.users.owner,id+'-object','synthetic-hh-attachment-'+letter+'.txt',id+'-question',at),
   ])
   if(solved)await app.db.batch([
    app.db.prepare("INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at) VALUES(?,?,?,?,?,'owner',?,2,?)").bind(id+'-answer',p,id,id+'-answer',w.users.owner,'synthetic-hh-answer-'+letter,at+response*1000),
    app.db.prepare("INSERT INTO conversation_resolutions(id,project_id,conversation_id,contact_id,ordinal,resolved_at,resolved_revision,cycle_start_revision,outcome,evidence_json) VALUES(?,?,?,?,1,?,2,0,?,'{}')").bind(id+'-resolution',p,id,customer,at+resolution*1000,letter==='a'?'ai':'human'),
    app.db.prepare('INSERT INTO conversation_ratings(resolution_id,value,comment,updated_at,revision) VALUES(?,?,?,?,1)').bind(id+'-resolution',rating,'synthetic-hh-comment-'+letter,at+resolution*1000),
    app.db.prepare("INSERT INTO csat_surveys(id,project_id,resolution_id,conversation_id,contact_id,recipient,channel,scale,locale,due_at,expires_at,state,created_at,updated_at) VALUES(?,?,?,?,?,?,'email','thumbs','en',?,?,?,?,?)").bind(id+'-survey',p,id+'-resolution',id,customer,'synthetic-hh-68@example.test',at,at+86400000,letter==='c'?'suppressed':letter==='b'?'failed':'sent',at,at),
    app.db.prepare("INSERT INTO csat_responses(resolution_id,project_id,contact_id,channel,scale,score,reason,comment,revision,updated_at,response_surface) VALUES(?,?,?,'widget','thumbs',?,'',?,1,?,'widget')").bind(id+'-resolution',p,customer,rating,'synthetic-hh-survey-'+letter,at+resolution*1000),
   ])
  }
  await app.db.batch([
   app.db.prepare('INSERT INTO conversations(id,project_id,contact_id,revision,created_at,updated_at) VALUES(?,?,?,1,?,?)').bind('synthetic-hh-foreign',q.projectId,q.projectId+'-customer',at,at),
   app.db.prepare("INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at) VALUES('synthetic-hh-foreign-message',?,'synthetic-hh-foreign','synthetic-hh-foreign',?,'contact','synthetic-hh-foreign-content',1,?)").bind(q.projectId,q.projectId+'-customer',at),
  ])
  await app.db.prepare('INSERT INTO contacts(id,project_id,email,created_at) VALUES(?,?,?,1)').bind('synthetic-hh-70',p,'synthetic-hh-70@example.test').run()
  await app.db.prepare("UPDATE conversations SET contact_id='synthetic-hh-70' WHERE id='synthetic-hh-b'").run()
  await app.db.prepare("INSERT INTO csat_optouts(project_id,contact_id,created_at) VALUES(?,'synthetic-hh-70',1)").bind(p).run()
  // Consume one real CSV page, narrow stored scope, and consume the same response.
  const pagingAt=Date.parse('2026-04-01T12:00:00Z'),paging=D+'/reports?period=custom&start=2026-04-01&end=2026-04-02&format=conversations.csv'
  for(let offset=0;offset<1001;offset+=100){const statements=[];for(let i=offset;i<Math.min(offset+100,1001);i++){const id='synthetic-hh-page-'+String(i).padStart(4,'0');statements.push(app.db.prepare('INSERT INTO conversations(id,project_id,contact_id,group_id,revision,created_at,updated_at) VALUES(?,?,?,?,1,?,?)').bind(id,p,p+'-customer',i<500?groups[0]:groups[1],pagingAt+i,pagingAt+i),app.db.prepare("INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at) VALUES(?,?,?,?,?,'contact','synthetic-hh-page-question',1,?)").bind(id+'-message',p,id,id+'-message',p+'-customer',pagingAt+i))}await app.db.batch(statements)}
  await app.db.batch([app.db.prepare('CREATE TABLE synthetic_report_pages(page INTEGER,rows INTEGER)'),app.db.prepare('CREATE TABLE synthetic_report_stream_errors(status INTEGER)')])
  const response=await app.request(paging,{token:tokens.all,headers:{'x-test-report-scope':JSON.stringify({project:p,role:roles.all,scope:selected})}}),reader=response.body.getReader(),decoder=new TextDecoder();let bytes='',failed=false
  try{for(;;){const part=await reader.read();if(part.done)break;bytes+=decoder.decode(part.value)}}catch{failed=true}finally{reader.releaseLock()}
  record('P1',`GET conversations.csv all; narrow to selected between page queries`,{status:response.status,streamRefused:failed,laterRow:bytes.includes('synthetic-hh-page-0500')})
  const streamErrors=await app.sql('SELECT status FROM synthetic_report_stream_errors')
  assert.deepEqual(streamErrors,[{status:403}],'the actual public response stream refuses after scope narrowing, even if its transport reports EOF')
  record('P1','public response stream refusal receipt',{streamErrors,transportRejected:failed})
  assert.equal(bytes.includes('synthetic-hh-page-1000'),false)
  const pages=await app.sql('SELECT page,rows FROM synthetic_report_pages ORDER BY page')
  assert.deepEqual(pages.slice(0,2),[{page:1,rows:500},{page:2,rows:0}])
  record('P1','D1 fixture page receipts',pages)
  assert.doesNotMatch(bytes,/synthetic-hh-page-(?:0[5-9]\d\d|1000)/)
  await scope('all',all)
  await app.db.prepare("DELETE FROM messages WHERE conversation_id LIKE 'synthetic-hh-page-%'").run();await app.db.prepare("DELETE FROM conversations WHERE id LIKE 'synthetic-hh-page-%'").run()
  record('P2','erasure', 'none; no erasure/retention code changed; existing support-outcomes erasure assertions run in report journey')
  record('P3','money','none; no money authority or provider-money code changed')
  for(const principal of ['all','selected','empty','foreign','owner','admin','null']){
   const token=tokens[principal],denied=principal==='foreign',filtered=['selected','empty'].includes(principal),count=denied?null:filtered?principal==='empty'?0:2:5
   const report=await app.call(path,{token});assert.equal(report.status,denied?403:200)
   if(!denied){assert.equal(report.data.volume,count);const expected=count===0?{count:0,median:null,p90:null}:count===2?{count:2,median:3000,p90:5000}:{count:4,median:4000,p90:7000};assert.deepEqual(report.data.firstResponse,expected);assert.deepEqual(report.data.firstResolution,count===0?{count:0,median:null,p90:null}:count===2?{count:2,median:25000,p90:40000}:{count:4,median:30000,p90:80000});assert.equal(report.data.aiResolution.total,count===5?4:count);assert.equal(report.data.satisfaction.total,count===5?4:count);assert.equal(report.data.daily.reduce((sum,r)=>sum+r.conversations,0),count)}
   record('P4',principal+' GET reports',{status:report.status,volume:report.data.volume,firstResponse:report.data.firstResponse,comments:report.data.comments})
   const csv=await app.call(path+'&format=conversations.csv',{token}),summary=await app.call(path+'&format=summary.csv',{token}),transcript=await app.call(path+'&format=transcripts.json',{token}),survey=await app.call(results,{token}),surveyCSV=await app.call(results+'?format=csv',{token}),brand=await app.call(brands,{token})
   for(const result of [csv,summary,transcript,survey,surveyCSV,brand])assert.equal(result.status,denied?403:200)
   if(!denied){
    const expectedIds=(count===0?[]:count===2?['a','c']:rows.map(r=>r[0])).map(x=>'synthetic-hh-'+x)
    assert.deepEqual(csv.data.trim().split('\r\n').slice(1).map(line=>line.split(',')[0].slice(1,-1)),expectedIds)
    assert.deepEqual(transcript.data.conversations.map(c=>c.id),expectedIds)
    assert.equal(survey.data.summary.rated,count===5?4:count);assert.equal(survey.data.summary.positive,count===5?2:count===2?1:0);assert.equal(survey.data.summary.invited,count===5?4:count);assert.equal(survey.data.summary.optedOut,count===5?1:0);assert.deepEqual(survey.data.summary.delivery,count===5?{failed:1,sent:2,suppressed:1}:count===2?{sent:1,suppressed:1}:{})
    assert.deepEqual(survey.data.results.map(r=>r.conversationId).sort(),expectedIds.filter(id=>!id.endsWith('-e')))
    assert.equal(brand.data.data.aggregate.volume,count+1)
    if(filtered)for(const result of [report,csv,summary,transcript,survey,surveyCSV,brand])assert.doesNotMatch(JSON.stringify(result.data),/synthetic-hh-(?:b|d|e)(?:[" ,]|-(?:question|answer|private|media|resolution|note|object))|synthetic-hh-(?:comment|private|imported-private|attachment|survey)-(?:b|d|e)/)
    for(const c of transcript.data.conversations){assert.ok(c.privateNotes.some(n=>n.content==='synthetic-hh-private-'+c.id.at(-1)));assert.ok(c.privateNotes.some(n=>n.content==='synthetic-hh-imported-private-'+c.id.at(-1)));assert.ok(c.attachments.some(m=>m.filename==='synthetic-hh-attachment-'+c.id.at(-1)+'.txt'))}
    const {exportedAt,...stableTranscript}=transcript.data
    snapshot[principal]=digest([report.data,csv.data,summary.data,stableTranscript,survey.data,surveyCSV.data,brand.data])
   }
   record('P5',principal+' GET conversations.csv / summary.csv',{status:csv.status,rows:denied?null:csv.data.trim().split('\r\n').length-1,hiddenComment:JSON.stringify(csv.data).includes('synthetic-hh-comment-b')})
   record('P6',principal+' GET transcripts.json',{status:transcript.status,ids:transcript.data.conversations?.map(c=>c.id),hiddenNote:JSON.stringify(transcript.data).includes('synthetic-hh-private-b'),hiddenAttachment:JSON.stringify(transcript.data).includes('synthetic-hh-attachment-b.txt')})
   record('P7',principal+' GET results / results.csv',{status:survey.status,summary:survey.data.summary,ids:survey.data.results?.map(r=>r.conversationId)})
   record('P8',principal+' GET brands/reports',{status:brand.status,aggregate:brand.data.data?.aggregate})
  }
  assert.equal(snapshot.owner,snapshot.all);assert.equal(snapshot.owner,snapshot.null);assert.equal(snapshot.owner,snapshot.admin)
  record('P9','all / NULL / owner / admin every ordinary door',{identical:snapshot.owner===snapshot.all&&snapshot.owner===snapshot.null&&snapshot.owner===snapshot.admin,digest:snapshot.owner})
  // Frozen custody keeps the same outcome even for the empty ticket selection.
  const fixed=Date.parse('2026-11-01T00:00:00Z'),headers={'x-test-report-now':String(fixed)},options={token:tokens.empty,headers}
  const team=await app.call(path.replace('/reports?','/reports/team?'),options),timer=await app.call(D+'/conversations/synthetic-hh-b/timer',options),scheduled=await app.call(D+'/report-schedules',options)
  assert.equal(team.status,200);assert.equal(team.data.denominators.cohort,5);assert.equal(timer.status,200);assert.equal(timer.data.totalMs,0);assert.equal(scheduled.status,200);assert.deepEqual(scheduled.data.schedules,[])
  const schedule=await app.ok(D+'/report-schedules',{token:tokens.empty,body:{name:'Synthetic scoped reviewer report',frequency:'daily',hour:0,recipients:[w.users.owner],includeImported:false}})
  await app.db.prepare('UPDATE report_schedules SET window_date=?,next_run_at=? WHERE id=?').bind('2026-03-09',fixed-1,schedule.id).run()
  await app.scheduled();const jobs=await app.takeJobs(),job=jobs.find(j=>j.type==='reports.schedule');assert.ok(job);await app.runJobs([job],headers)
  const mail=sent.find(m=>m.attachments?.some(a=>a.filename.startsWith('team-report-')));assert.ok(mail)
  const attachment=Buffer.from(mail.attachments[0].content,'base64').toString();assert.match(attachment,/"denominators.cohort","5"/)
  snapshot.frozen=digest([team.status,team.data,timer.status,timer.data,scheduled.status,scheduled.data,attachment])
  record('P10','identical-body receipt',{digest:snapshot.frozen})
  record('P10','empty-scope GET team / hidden-ticket timer / scheduled-dispatch',{teamStatus:team.status,cohort:team.data.denominators.cohort,timerStatus:timer.status,timer:timer.data,scheduledStatus:scheduled.status,scheduled:scheduled.data,dispatchCohort:5,providerBoundary:'network-edge fake'})
  await app.db.prepare("INSERT INTO widget_campaigns(project_id,id,revision,config_json,updated_at) VALUES(?,'synthetic-hh-campaign',1,'{\"name\":\"Synthetic campaign\"}',1)").bind(p).run()
  const campaign=await app.call(path,{token:tokens.selected});assert.equal(campaign.status,403)
  for(const name of ['all','owner','admin','null'])assert.equal((await app.call(path,{token:tokens[name]})).status,200)
  record('P4','selected ordinary report with workspace campaign aggregate',{status:campaign.status})
  return snapshot
 }finally{await app.close();await rm(temporary,{recursive:true,force:true})}
}
