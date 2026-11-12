import assert from 'node:assert/strict'
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createHash} from 'node:crypto'
import {startApp} from '../../journeys/kit/app.mjs'
import {writeLegacyPackage} from '../legacy-package.mjs'
const hash=value=>createHash('sha256').update(value).digest('hex')

export async function legacyAdoptionJourney(){
 const app=await startApp({entry:'tests/helpers/legacy-adoption/worker.ts',captureQueue:true,cf:false,bindings:{H2H_SETUP_TOKEN:'synthetic-adoption-setup',OWNER_EMAIL:'synthetic-owner@example.test'}})
 const scratch=await mkdtemp(join(tmpdir(),'legacy-adoption-'))
 try{
  const owner=(await app.call('/api/identity/bootstrap',{body:{setupToken:'synthetic-adoption-setup',email:'synthetic-owner@example.test',password:'Synthetic adoption password 42!',allowedOrigin:'https://synthetic-setup.example'},headers:{Origin:app.origin},status:201})).data
  const token=owner.token,setup=owner.projectId,source='synthetic-adopted-workspace',nativeId=owner.userId
  const foreign=await app.seedWorkspace('adoption-foreign')
  await app.call('/api/rer/business-project',{token,body:{projectId:setup},headers:{Origin:app.origin},status:200})
  const setupBefore=await app.first('SELECT p.*,ps.settings_json FROM projects p JOIN project_settings ps ON ps.project_id=p.id WHERE p.id=?',setup)
  const linkBefore=await app.first('SELECT * FROM h2h_business_project')
  const userBefore=await app.sql('SELECT * FROM users ORDER BY id'),credentialsBefore=await app.sql('SELECT * FROM credentials ORDER BY user_id'),sessionBefore=await app.sql('SELECT * FROM sessions ORDER BY token_hash')
  const date='2026-01-01T00:00:00.000Z',staff='synthetic-source-staff',conversation='synthetic-history-conversation'
  const attachment=Buffer.from('Synthetic historical note attachment'),objectKey=`legacy/projects/${source}/media/synthetic-note-media`
  const raw={format:'happytohelp-legacy-v1',source:{repository:'synthetic-happytohelp',revision:'synthetic-adoption-v2',exportedAt:date,projectId:source,mailFromDomain:'synthetic-mail.example'},tables:{
   projects:[{id:source,name:'Synthetic historical support',website:'https://synthetic-history.example',slug:'synthetic-history',email_from_address:'synthetic-support@example.test',created_at:date}],
   users:[{id:staff,name:'Historical source admin',email:'synthetic-staff@example.test',created_at:date},{id:nativeId,name:'Historical owner snapshot',email:'synthetic-owner@example.test',created_at:date},{id:foreign.users.owner,name:'Historical foreign snapshot',email:'owner-adoption-foreign@example.test',created_at:date},{id:'synthetic-deleted-staff',name:'Deleted staff',email:'synthetic-deleted@example.test',deleted_at:date,created_at:date}],
   project_users:[{id:'synthetic-staff-member',project_id:source,user_id:staff,role:'admin'},{id:'synthetic-native-member',project_id:source,user_id:nativeId,role:'owner'},{id:'synthetic-foreign-member',project_id:source,user_id:foreign.users.owner,role:'owner'},{id:'synthetic-deleted-member',project_id:source,user_id:'synthetic-deleted-staff',role:'owner',deleted_at:date}],
   contacts:[{id:'synthetic-historical-contact',project_id:source,name:'Historical visitor',created_at:date}],
   conversations:[{id:conversation,project_id:source,contact_id:'synthetic-historical-contact',agent_id:staff,created_at:date}],
   messages:[{id:'synthetic-historical-reply',project_id:source,conversation_id:conversation,agent_id:staff,content:'A retained human reply',created_at:date},{id:'synthetic-overlapping-author',project_id:source,conversation_id:conversation,agent_id:nativeId,content:'Original author differs from current owner profile',created_at:'2026-01-01T00:00:01.000Z'}],
   events:[{id:'synthetic-history-note',conversation_id:conversation,agent_id:staff,type:'INTERNAL_NOTE',payload:'A retained private note',created_at:date}],
   macros:[{id:'synthetic-history-macro',project_id:source,title:'Historical saved reply',content:'Saved historical answer',created_by_id:staff,created_at:date}],
   ais:[{id:'synthetic-historical-ai',project_id:source,name:'Old assistant',model:'synthetic-model',is_enabled:1,created_at:date}],
   media:[{id:'synthetic-note-media',project_id:source,object_key:objectKey,filename:'synthetic-note.txt',size:attachment.length,mime_type:'text/plain',created_at:date}],
   mediables:[{id:'synthetic-note-media-link',media_id:'synthetic-note-media',mediable_type:'App\\Models\\Event',mediable_id:'synthetic-history-note'}],
   local_agent_grants:[{id:'synthetic-history-grant',project_id:source,user_id:staff,created_at:date}],
   local_agent_devices:[{id:'synthetic-history-device',project_id:source,user_id:staff,grant_id:'synthetic-history-grant',client_session_id:'synthetic-old-session',created_at:date}],
   support_delegations:[{id:'synthetic-history-job',project_id:source,conversation_id:conversation,user_id:staff,device_id:'synthetic-history-device',status:'running',created_at:date}],
  },objects:[{key:objectKey,dataBase64:attachment.toString('base64'),sha256:hash(attachment)}]}
  const files=await app.files
  const stage=async(bundle,key)=>{
   const root=join(scratch,key),packet=await writeLegacyPackage(root,bundle)
   const sha=packet.manifestSha256,metadata={contractVersion:'2',projectId:setup,manifestSha256:sha}
   await files.put(`legacy-package/${sha}/manifest.json`,await readFile(join(root,'manifest.json')),{sha256:sha,customMetadata:metadata})
   for(const [kind,list] of [['chunk',packet.manifest.chunks],['context',packet.manifest.context]])for(const part of list)await files.put(`legacy-package/${sha}/${kind==='chunk'?'chunks':'context'}/${part.file}`,await readFile(join(root,part.file)),{sha256:part.sha256,customMetadata:{...metadata,kind,file:part.file}})
   for(const part of packet.manifest.objects)await files.put(`legacy-package/${sha}/objects/${part.file}`,await readFile(join(root,part.file)),{sha256:part.sha256,customMetadata:{...metadata,kind:'object',file:part.file}})
   return {...packet,sha,base:`/api/move-in/projects/${setup}/legacy-import/${sha}/adoption`}
  }
  const packet=await stage(raw,'primary'),approve={approvedManifestSha256:packet.sha,sourceProjectId:source,policyVersion:2},headers={Origin:app.origin}
  const review=(await app.call(packet.base,{token,status:200})).data.data
  assert.equal(review.custodyProjectId,setup);assert.equal(review.destinationProjectId,source);assert.equal(review.canApprove,true);assert.equal(review.historicalMembershipRows,4)
  assert.ok(!JSON.stringify(review).includes('@'),'review has no staff directory')
  await app.call(packet.base,{status:401})
  for(const foreignToken of Object.values(foreign.tokens))await app.call(packet.base,{token:foreignToken,status:403})
  await app.call(packet.base+'/approve',{token,body:approve,headers:{Origin:'https://synthetic-foreign.example'},status:403})
  await app.call(packet.base+'/approve',{body:approve,headers:{Origin:'https://synthetic-foreign.example',Cookie:`h2h_session=${token}`},status:403})
  await app.db.prepare('UPDATE sessions SET expires_at=0 WHERE token_hash=?').bind(hash(token)).run()
  await app.call(packet.base,{token,status:401})
  await app.db.prepare('UPDATE sessions SET expires_at=? WHERE token_hash=?').bind(sessionBefore.find(s=>s.token_hash===hash(token)).expires_at,hash(token)).run()
  await app.call(packet.base+'/approve',{token,body:{...approve,sourceProjectId:'synthetic-altered-destination'},headers,status:409})
  await app.call(packet.base+'/approve',{token,body:{...approve,approvedManifestSha256:'0'.repeat(64)},headers,status:409})
  await app.db.prepare("UPDATE owner_setup SET claim_id='existing-installation'").run()
  assert.equal((await app.call(packet.base,{token,status:409})).data.code,'installation_owner_binding_required')
  await app.db.prepare('UPDATE owner_setup SET claim_id=?').bind(nativeId).run()
  await app.db.prepare('DELETE FROM session_factors WHERE token_hash=?').bind(hash(token)).run()
  assert.equal((await app.call(packet.base+'/approve',{token,body:approve,headers,status:403})).data.code,'step_up_required')
  await app.db.prepare("INSERT INTO session_factors VALUES(?,?,'password',?)").bind(hash(token),nativeId,Date.now()).run()
  await app.db.prepare("UPDATE project_settings SET settings_json=json_set(settings_json,'$.two_factor_roles',json('[\"owner\"]')) WHERE project_id=?").bind(setup).run()
  assert.equal((await app.call(packet.base+'/approve',{token,body:approve,headers,status:401})).data.code,'two_factor_required')
  await app.db.prepare('UPDATE project_settings SET settings_json=? WHERE project_id=?').bind(setupBefore.settings_json,setup).run()
  assert.equal(await app.first('SELECT 1 FROM projects WHERE id=?',source),null)
  await app.call(packet.base+'/approve',{token,body:approve,headers,status:202})
  assert.equal(await app.first('SELECT 1 FROM projects WHERE id=?',source),null,'approval does not create canonical rows')
  const competitor=await stage({...raw,source:{...raw.source,revision:'synthetic-competing-export'}},'competitor')
  assert.equal((await app.call(competitor.base,{token,status:200})).data.data.canApprove,false)
  await app.call(competitor.base+'/approve',{token,body:{...approve,approvedManifestSha256:competitor.sha},headers,status:409})
  const collision=await stage({...raw,source:{...raw.source,projectId:foreign.projectId},tables:{projects:[{id:foreign.projectId,name:foreign.name,website:foreign.allowedOrigin,created_at:date}]}},'collision')
  for(const deleted of [false,true]){
   if(deleted)await app.db.prepare("INSERT INTO project_settings(project_id,settings_json,updated_at) VALUES(?,'{\"deleted_at\":1}',1)").bind(foreign.projectId).run()
   await app.call(collision.base+'/approve',{token,body:{...approve,approvedManifestSha256:collision.sha,sourceProjectId:foreign.projectId},headers,status:409})
  }
  await app.db.prepare('DELETE FROM project_settings WHERE project_id=?').bind(foreign.projectId).run()
  const clashingSource='synthetic-widget-collision',clashing=await stage({...raw,source:{...raw.source,projectId:clashingSource},tables:{projects:[{id:clashingSource,name:'Synthetic collision',website:'https://synthetic-collision.example',widget_key:foreign.widgetKey,created_at:date}]}},'widget-collision')
  await app.call(clashing.base+'/approve',{token,body:{...approve,approvedManifestSha256:clashing.sha,sourceProjectId:clashingSource},headers,status:202})
  const refused=(await app.call('/_test/adoption/drive',{body:{sha:clashing.sha},status:409})).data
  assert.equal(refused.code,'canonical_target_conflict')
  assert.equal(await app.first('SELECT 1 FROM projects WHERE id=?',clashingSource),null)
  assert.equal(await app.first('SELECT 1 FROM legacy_import_rows'),null,'whole-package preflight refuses before journals/native writes')
  await app.db.prepare("UPDATE legacy_import_worker_runs SET state='stopped' WHERE manifest_sha256=?").bind(clashing.sha).run()
  const drive=body=>app.call('/_test/adoption/drive',{body:{sha:packet.sha,...body},status:body?.refused?409:200})
  const first=(await drive({limit:1})).data
  assert.equal(first.partsApplied,1)
  assert.equal((await app.first('SELECT state FROM legacy_workspace_adoptions WHERE manifest_sha256=?',packet.sha)).state,'created')
  assert.deepEqual(await app.sql('SELECT user_id,role FROM memberships WHERE project_id=?',source),[{user_id:nativeId,role:'owner'}])
  await app.db.prepare("UPDATE projects SET name='Synthetic native edit' WHERE id=?").bind(source).run()
  assert.equal((await drive({refused:true})).data.code,'canonical_target_conflict','native project edits prevent adoption resume')
  await app.db.prepare('UPDATE projects SET name=? WHERE id=?').bind(raw.tables.projects[0].name,source).run()
  // A stopped/replaced process resumes persistent provenance; expiry/revocation
  // inside the actual batch refuses even after invocation-entry admission.
  await drive({revokeBeforeBatch:true,refused:true})
  await app.db.prepare('UPDATE sessions SET revoked_at=NULL WHERE token_hash=?').bind(hash(token)).run()
  await drive({changeRunBeforeBatch:true,refused:true})
  await app.configure({})
  const full=(await drive({})).data
  assert.deepEqual(full.after,full.before,'inert provisioning/import starts no work')
  const replay=(await drive({})).data
  assert.equal(replay.applied,0);assert.ok(replay.replayed>0)
  await drive({swapProfile:true,refused:true})
  assert.deepEqual(await app.sql('SELECT * FROM users ORDER BY id'),userBefore)
  assert.deepEqual(await app.sql('SELECT * FROM credentials ORDER BY user_id'),credentialsBefore)
  assert.deepEqual(await app.sql('SELECT * FROM sessions ORDER BY token_hash'),sessionBefore)
  assert.deepEqual(await app.first('SELECT p.*,ps.settings_json FROM projects p JOIN project_settings ps ON ps.project_id=p.id WHERE p.id=?',setup),setupBefore)
  assert.deepEqual(await app.first('SELECT * FROM h2h_business_project'),linkBefore)
  assert.equal(await app.first('SELECT 1 FROM user_settings WHERE user_id=?',staff),null)
  assert.equal((await app.first('SELECT assigned_to FROM conversations WHERE id=?',conversation)).assigned_to,null)
  assert.equal((await app.first('SELECT source_user_id FROM legacy_actor_origins WHERE project_id=? AND target_table=\'conversations\' AND target_id=?',source,conversation)).source_user_id,staff)
  assert.equal((await app.first('SELECT created_by FROM macros WHERE id=\'synthetic-history-macro\'')).created_by,nativeId)
  assert.equal((await app.first("SELECT source_user_id FROM legacy_actor_origins WHERE project_id=? AND target_table='macros'",source)).source_user_id,staff)
  assert.equal((await app.first("SELECT is_enabled FROM ai_profiles WHERE id='synthetic-historical-ai'")).is_enabled,0)
  assert.equal((await app.first('SELECT is_enabled FROM email_settings WHERE project_id=?',source)).is_enabled,0)
  assert.equal(await app.first("SELECT 1 FROM workflow_rules WHERE project_id=? AND state='published'",source),null)
  assert.equal(await app.first('SELECT 1 FROM user_project_preferences WHERE project_id=?',source),null)
  assert.ok((await app.first("SELECT revoked_at FROM local_grants WHERE id='synthetic-history-grant'")).revoked_at)
  assert.equal((await app.first("SELECT status FROM local_jobs WHERE id='synthetic-history-job'")).status,'revoked')
  for(const [table,rows] of Object.entries(packet.bundle.tables)){
   const journal=await app.sql('SELECT source_json FROM legacy_import_rows WHERE source_table=? ORDER BY source_id',table)
   assert.equal(journal.length,rows.length,'journal equals package for '+table)
   const original=new Map(rows.map(r=>[String(r.id),r]))
   for(const row of journal){const stored=JSON.parse(row.source_json);assert.deepEqual(stored,original.get(String(stored.id)),'exact source row retained for '+table)}
  }
  const archived=await app.sql("SELECT source_table,count(*) n FROM legacy_import_rows WHERE source_table IN ('users','project_users') AND status='archived_only' GROUP BY source_table ORDER BY source_table")
  assert.deepEqual(archived,[{source_table:'project_users',n:4},{source_table:'users',n:4}])
  const {token:adoptedToken}=(await app.call('/api/identity/switch-project',{token,body:{projectId:source},status:200})).data
  const transcript=(await app.call(`/api/dashboard/conversations/${conversation}/buckets/${conversation}`,{token:adoptedToken,status:200})).data.data
  assert.equal(transcript.events.find(e=>e.id==='synthetic-history-note').agent.name,'Historical source admin')
  assert.equal(transcript.events.find(e=>e.id==='synthetic-history-note').payload,'A retained private note')
  const noteAttachment=transcript.events.find(e=>e.id==='synthetic-history-note').media[0]
  assert.equal(noteAttachment.id,'synthetic-note-media')
  const downloaded=await app.request(noteAttachment.url,{token:adoptedToken})
  assert.equal(downloaded.status,200);assert.equal(hash(Buffer.from(await downloaded.arrayBuffer())),hash(attachment))
  assert.equal(transcript.messages.find(m=>m.id==='synthetic-historical-reply').agent.name,'Historical source admin')
  assert.equal(transcript.messages.find(m=>m.id==='synthetic-overlapping-author').agent.name,'Historical owner snapshot')
  const bootstrap=(await app.call('/api/management/bootstrap',{token:adoptedToken,status:200})).data
  assert.deepEqual(bootstrap.agents.map(a=>a.id),[nativeId],'historical staff are not selectable members')
  await app.call(`/api/conversations/${conversation}/messages`,{token:foreign.tokens.owner,status:404})
  await app.call('/api/identity/switch-project',{token:foreign.tokens.owner,body:{projectId:source},status:403})
  const note=await app.first("SELECT * FROM move_in_notes WHERE id='synthetic-history-note'")
  assert.equal(note.content,'A retained private note');assert.equal(JSON.parse(note.author_json).name,'Historical source admin')
  assert.equal(await app.first("SELECT 1 FROM conversation_notes WHERE id='synthetic-history-note'"),null)
  const invitation=(await app.call(`/api/management/projects/${source}/agents`,{token:adoptedToken,body:{email:'owner-adoption-foreign@example.test',role:'operator'},status:201})).data.data
  const invitationToken=new URL(invitation.invitationUrl).searchParams.get('token')
  await app.call('/api/identity/accept-invitation',{token:foreign.tokens.owner,body:{token:invitationToken},status:200})
  assert.equal((await app.first('SELECT role FROM memberships WHERE project_id=? AND user_id=?',source,foreign.users.owner)).role,'operator','only the new invitation grants its approved role')
  assert.equal(app.requests.length,0,'no provider network action')
  const report={status:'pass',sourceProjectId:source,setupUnchanged:true,businessLinkUnchanged:true,historicalStaffRows:4,historicalMembershipRows:4,nativeMembershipsAdded:1,nativeUsersAdded:0,firstSliceRows:first.applied,noteMediaBytes:attachment.length,originalRows:Object.values(packet.manifest.source.rowCounts).reduce((a,b)=>a+b,0),appliedRows:full.applied,replayedRows:replay.replayed,replayApplied:replay.applied,workUnchanged:true,preflightAuthorityRefusals:true,transactionAuthorityRefusals:true,mountedProductAcceptance:'pending C',registration:'pending C/lane after index-drain terminal'}
  if(process.env.LEGACY_ADOPTION_RECEIPT)await writeFile(process.env.LEGACY_ADOPTION_RECEIPT,JSON.stringify(report,null,2)+'\n')
  console.log('LEGACY_ADOPTION_RESULT '+JSON.stringify(report));return report
 }finally{await app.close();await rm(scratch,{recursive:true,force:true})}
}
if(process.argv[1]===new URL(import.meta.url).pathname)await legacyAdoptionJourney()
