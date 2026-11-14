import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {writeLegacyPackage} from '../legacy-package.mjs'
import {createNativeRehearsal,uploadLegacy,finishLegacy} from './legacy-fixture.mjs'
import {prepareAcceptedZendesk,finishZendeskDay} from './zendesk.mjs'

const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
const utcDay=offset=>new Date(Date.now()+offset*86400000).toISOString().slice(0,10)
async function deltaPackage(root,origin,day){
 const bundle=structuredClone(origin.bundle),cutoffs=['2026-11-12T12:00:00.000000Z','2026-11-13T00:00:00.000000Z','2026-11-13T12:00:00.000000Z'],since=['2026-11-11T23:55:00.000000Z','2026-11-12T11:55:00.000000Z','2026-11-12T23:55:00.000000Z']
 bundle.source={...bundle.source,snapshotClock:cutoffs[day],sourceCutoff:cutoffs[day],watermark:new Date(Date.parse(cutoffs[day])-300000).toISOString().replace('.000Z','.000000Z'),watermarkOverlapSeconds:300}
 bundle.tables.contacts[0].name='Legacy changed customer '+day
 for(let n=0;n<=day;n++)bundle.tables.messages.push({id:'synthetic-daily-message-'+n,project_id:bundle.source.projectId,conversation_id:'synthetic-conversation',contact_id:'synthetic-contact',content:'Synthetic daily copy '+n,created_at:new Date(Date.parse(cutoffs[n])-3600000).toISOString()})
 const tables={projects:bundle.tables.projects,users:bundle.tables.users,project_users:bundle.tables.project_users,contacts:bundle.tables.contacts,conversations:bundle.tables.conversations,messages:bundle.tables.messages}
 const p=await writeLegacyPackage(root,bundle,{rowsPerChunk:10,delta:{since:since[day],tables}})
 return {...p,root,bytes:await readFile(join(root,'manifest.json'))}
}
export async function legacyDailyCopies(app,{directory,owner,setup,source,origin,zendesk}){
 const basePull=await prepareAcceptedZendesk(app,{setup,token:owner.token,zendesk})
 const consent=await createNativeRehearsal(app,{owner,setup,origin,zendeskProjectId:setup,zendeskPullId:basePull.id}),token=consent.credential
 const copy=p=>consent.root+'/copy/legacy/'+p.manifestSha256
 const full=await app.call(copy(origin)+'/manifest',{token,method:'PUT',raw:true,body:origin.bytes,headers:{'Content-Type':'application/json','X-Manifest-SHA256':origin.manifestSha256,'X-Rehearsal-Day':utcDay(-2)}})
 assert.equal(full.status,409,'delegated consent admits delta only')
 const p1=await deltaPackage(join(directory,'daily-one'),origin,0),p2=await deltaPackage(join(directory,'daily-two'),origin,1),p3=await deltaPackage(join(directory,'daily-stop'),origin,2)
 const count=async()=>app.first('SELECT (SELECT count(*) FROM users) users,(SELECT count(*) FROM memberships) memberships,(SELECT count(*) FROM local_grants) grants,(SELECT count(*) FROM conversation_outbox) outbox,(SELECT count(*) FROM email_deliveries) deliveries')
 const before=await count(),sessionHash=sha(owner.token),session=await app.first('SELECT expires_at FROM sessions WHERE token_hash=?',sessionHash)
 await app.db.batch([app.db.prepare("UPDATE contacts SET name='Native retained customer' WHERE id='synthetic-contact'"),app.db.prepare("UPDATE projects SET name='Native retained workspace' WHERE id=?").bind(source),app.db.prepare("UPDATE project_settings SET settings_json=json_set(settings_json,'$.synthetic_rehearsal_kept',1) WHERE project_id=?").bind(source),app.db.prepare('UPDATE sessions SET expires_at=0 WHERE token_hash=?').bind(sessionHash)])
 const bad=structuredClone(p1.manifest);bad.source.since='2026-11-11T23:55:00.000001Z';const badBytes=Buffer.from(JSON.stringify(bad)),badSha=sha(badBytes)
 assert.equal((await app.call(consent.root+'/copy/legacy/'+badSha+'/manifest',{token,method:'PUT',raw:true,body:badBytes,headers:{'Content-Type':'application/json','X-Manifest-SHA256':badSha,'X-Rehearsal-Day':utcDay(-2)}})).status,409,'submillisecond since changes cannot skip a source interval')
 await uploadLegacy(app,copy(p1),p1,token,{day:utcDay(-2)})
 assert.equal((await app.call(`/api/move-in/projects/${setup}/legacy-import/${p1.manifestSha256}/status`,{token})).status,401,'copier credential is not a native session')
 await app.call(copy(p1)+'/start',{token,body:{approvedManifestSha256:p1.manifestSha256},status:202})
 assert.equal((await app.call(copy(p2)+'/manifest',{token,method:'PUT',raw:true,body:p2.bytes,headers:{'Content-Type':'application/json','X-Manifest-SHA256':p2.manifestSha256,'X-Rehearsal-Day':utcDay(-1)}})).status,409,'next SHA cannot precede verified prior copy')
 const first=await finishLegacy(app,copy(p1),token)
 assert.equal(Object.hasOwn(first,'diagnostics'),false);assert.deepEqual(Object.keys(first.work),['unchanged'])
 assert.equal((await app.first("SELECT name FROM contacts WHERE id='synthetic-contact'")).name,'Native retained customer')
 assert.ok(await app.first('SELECT 1 FROM legacy_import_conflicts WHERE source_id=?','synthetic-contact'))
 const replayCount=await app.first('SELECT count(*) n FROM legacy_import_rows')
 await app.call(copy(p1)+'/start',{token,body:{approvedManifestSha256:p1.manifestSha256},status:200})
 assert.deepEqual(await app.first('SELECT count(*) n FROM legacy_import_rows'),replayCount)
 await finishZendeskDay(app,{...consent,day:utcDay(-2)})
 // Expiry is a clock fixture; the actual custody scheduler and reduction-only
 // cleanup remove original bodies, retaining verified origin and journal lineage.
 await app.db.prepare('UPDATE legacy_package_custody SET expires_at=0 WHERE manifest_sha256=?').bind(origin.manifestSha256).run()
 for(let n=0;n<30;n++){
  await app.scheduled();await app.runJobs(await app.takeJobs())
  if((await app.first('SELECT status FROM legacy_package_custody WHERE manifest_sha256=?',origin.manifestSha256)).status==='purged')break
  await app.db.prepare('UPDATE legacy_package_custody SET next_cleanup_at=0 WHERE manifest_sha256=?').bind(origin.manifestSha256).run()
 }
 assert.equal(await (await app.files).head(`legacy-package/${origin.manifestSha256}/manifest.json`),null)
 assert.ok(await app.first("SELECT 1 FROM legacy_workspace_adoptions WHERE manifest_sha256=? AND state='created'",origin.manifestSha256))
 await app.db.batch([app.db.prepare("DELETE FROM move_in_message_sources WHERE message_id='synthetic-daily-message-0'"),app.db.prepare("DELETE FROM message_authorship WHERE message_id='synthetic-daily-message-0'"),app.db.prepare("DELETE FROM messages WHERE id='synthetic-daily-message-0'")])
 await uploadLegacy(app,copy(p2),p2,token,{day:utcDay(-1)})
 await app.call(copy(p2)+'/start',{token,body:{approvedManifestSha256:p2.manifestSha256},status:202})
 const second=await finishLegacy(app,copy(p2),token)
 assert.equal(second.journalEqualsPackage,true);assert.equal(await app.first("SELECT 1 FROM messages WHERE id='synthetic-daily-message-0'"),null,'delta preserves native deletion')
 assert.ok(await app.first("SELECT 1 FROM legacy_import_rows WHERE source_table='messages' AND source_id='synthetic-daily-message-1'"),'new source message is accounted under normal native-conflict semantics')
 assert.equal((await app.first('SELECT name FROM projects WHERE id=?',source)).name,'Native retained workspace')
 assert.equal((await app.first("SELECT json_extract(settings_json,'$.synthetic_rehearsal_kept') kept FROM project_settings WHERE project_id=?",source)).kept,1)
 const lineages=await app.sql('SELECT manifest_sha256,origin_sha256,verified_at FROM legacy_rehearsal_lineage WHERE rehearsal_id=? ORDER BY day',consent.grant.id)
 assert.deepEqual(lineages.map(l=>l.manifest_sha256),[p1.manifestSha256,p2.manifestSha256]);assert.ok(lineages.every(l=>l.origin_sha256===origin.manifestSha256&&l.verified_at))
 await finishZendeskDay(app,{...consent,day:utcDay(-1)})
 await uploadLegacy(app,copy(p3),p3,token,{day:utcDay(0)})
 await app.call(copy(p3)+'/start',{token,body:{approvedManifestSha256:p3.manifestSha256},status:202})
 let stopped=false
 for(let n=0;n<400;n++){
  const value=(await app.call(copy(p3)+'/result',{token,status:200})).data.data
  assert.notEqual(value.run.state,'paused',JSON.stringify(value))
  const jobs=await app.takeJobs()
  if(value.run.phase==='rows'){
   const pending=app.runJobs(jobs,{'x-legacy-barrier':'before_canonical'})
   await app.until(async()=> (await app.call('/_test/legacy/barrier')).data.barrier==='before_canonical')
   const rows=await app.first('SELECT count(*) n FROM legacy_import_rows')
   await app.call(consent.root+'/copy/stop',{token,body:{},status:202})
   await app.call('/_test/legacy/barrier',{body:{}});await pending
   assert.deepEqual(await app.first('SELECT count(*) n FROM legacy_import_rows'),rows)
   await app.runJobs(jobs)
   assert.deepEqual(await app.first('SELECT count(*) n FROM legacy_import_rows'),rows,'old wake cannot reopen a closed generation')
   stopped=true;break
  }
  await app.runJobs(jobs)
 }
 assert.equal(stopped,true)
 assert.equal((await app.call(copy(p3)+'/resume',{token,body:{approvedManifestSha256:p3.manifestSha256}})).status,401)
 assert.equal(await app.first("SELECT 1 FROM messages WHERE id='synthetic-daily-message-2'"),null)
 assert.deepEqual(await count(),before,'historical copies create no native principals or authored work')
 await app.db.prepare('UPDATE sessions SET expires_at=? WHERE token_hash=?').bind(session.expires_at,sessionHash).run()
 const closed=(await app.call(consent.root,{token:owner.token,status:200})).data.data
 assert.equal(closed.state,'closed');assert.equal(closed.cleanup.state,'pending')
 return {days:lineages.length,verified:true,originalSourcePurged:true,sessionExpiryDetached:true,nativeEditsKept:true,oldWakeFenced:true}
}
