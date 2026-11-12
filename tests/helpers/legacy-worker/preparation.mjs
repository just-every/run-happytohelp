import assert from 'node:assert/strict'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {startApp} from '../../journeys/kit/app.mjs'
import {writeLegacyPackage} from '../legacy-package.mjs'
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
export async function workerPreparation(){
 const app=await startApp({entry:'tests/helpers/legacy-worker/worker.ts',captureQueue:true,cf:false})
 const directory=await mkdtemp(join(tmpdir(),'legacy-worker-reader-'))
 try{
  const owner=await app.seedWorkspace('legacy-reader'),foreign=await app.seedWorkspace('legacy-foreign')
  const bundle={format:'happytohelp-legacy-v1',source:{repository:'synthetic',revision:'synthetic',exportedAt:'2026-01-01T00:00:00.000Z',projectId:owner.projectId},tables:{contacts:[{id:'synthetic-reader-contact',project_id:owner.projectId,created_at:1,name:'Synthetic'}]}}
  const {manifest,manifestSha256:digest}=await writeLegacyPackage(directory,bundle)
  const files=await app.files,metadata={contractVersion:'1',projectId:owner.projectId,manifestSha256:digest}
  const manifestBytes=await readFile(join(directory,'manifest.json'))
  await files.put(`legacy-package/${digest}/manifest.json`,manifestBytes,{sha256:digest,customMetadata:metadata})
  for(const [kind,list] of [['chunk',manifest.chunks],['context',manifest.context]])for(const part of list)await files.put(`legacy-package/${digest}/${kind==='chunk'?'chunks':'context'}/${part.file}`,await readFile(join(directory,part.file)),{sha256:part.sha256,customMetadata:{...metadata,kind,file:part.file}})
  const query=`/_test/legacy/reader?sha=${digest}&project=${owner.projectId}`
  const initial=(await app.call(query,{status:200})).data
  assert.equal(initial.rows,1);assert.equal(initial.sourceProjectId,owner.projectId)
  assert.equal((await app.call(`/_test/legacy/reader?sha=${digest}&project=${foreign.projectId}`,{status:404})).data.code,'package_not_found')
  const identity=(await app.call('/_test/legacy/chunk-identity',{body:{sha:digest,projectId:owner.projectId},status:200})).data
  assert.equal(identity.same,true,'original part identity equals the existing engine identity')
  const part=manifest.chunks[0],key=`legacy-package/${digest}/chunks/${part.file}`,original=await readFile(join(directory,part.file))
  const tampered=Buffer.from(original);tampered[tampered.length-2]=32
  // Metadata cannot bless a different stored checksum or body.
  await files.put(key,tampered,{sha256:sha(tampered),customMetadata:{...metadata,kind:'chunk',file:part.file,sha256:part.sha256}})
  assert.equal((await app.call(query,{status:422})).data.code,'digest_mismatch')
  await files.put(key,original.subarray(0,original.length-1),{sha256:sha(original.subarray(0,original.length-1)),customMetadata:{...metadata,kind:'chunk',file:part.file}})
  assert.equal((await app.call(query,{status:422})).data.code,'size_mismatch')
  await files.put(key,original,{sha256:part.sha256,customMetadata:{...metadata,kind:'chunk',file:part.file}})
  assert.equal((await app.call(query,{status:200})).data.identity,initial.identity)
  const probe=(await app.call('/_test/legacy/custody',{body:{projectId:owner.projectId,foreignProjectId:foreign.projectId},status:200})).data
  assert.equal(probe.sourceKept,true,'quoted knowledge source inserts retain exact source bytes')
  assert.equal(probe.journalExact,true,'the legacy source journal stays exact through the native write boundary')
  assert.equal(probe.nativeProtected,true,'ordinary native messages retain the knowledge boundary')
  assert.equal(probe.replayApplied,0)
  assert.equal(probe.planReadOnly,true)
  assert.ok(probe.planWrites>0)
  assert.equal(probe.importLiteral,true)
  assert.equal(probe.stateMatches,true)
  assert.equal(probe.deltaConflicts,0)
  const transcript=(await app.call(`/api/conversations/${probe.conversation}/messages`,{token:owner.tokens.owner,status:200})).data
  const message=transcript.messages.find(row=>row.id===probe.message)
  assert.equal(Buffer.byteLength(message.content),probe.sourceBytes,'the normal owner HTTP read returns the complete literal')
  assert.equal(message.content,Array.from({length:120},()=> 'A synthetic archive preserves the original customer account history across every import and verifies each relationship before any write.').join(' '))
  const facts={sourceBytes:probe.sourceBytes,stateMatches:probe.stateMatches,deltaConflicts:probe.deltaConflicts,renderedUnavailable:typeof message?.content==='string'&&message.content.includes('[Knowledge unavailable]'),replayApplied:probe.replayApplied}
  console.log('LEGACY_KNOWLEDGE_FIDELITY '+JSON.stringify(facts))
  assert.equal((await app.first('SELECT count(*) n FROM legacy_import_worker_runs')).n,0,'reader inspection creates no run')
  assert.equal((await app.first('SELECT count(*) n FROM legacy_delta_leases')).n,0,'the proof releases its own workspace lease')
  assert.equal(app.requests.length,0,'no provider request')
  return facts
 }finally{await app.close();await rm(directory,{recursive:true,force:true})}
}
