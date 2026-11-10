import {inWaves,readManifest,readPart,verifyPackage} from './package.mjs';
import {packageContext} from './context-index.mjs';
import {importObjects} from './objects.mjs';
import {isDelta,deltaPlan,emptyDeltaTotals,addDeltaTotals,deltaSummary} from './delta-package.mjs';
import {unmarkRetired} from './retire-marker.mjs';

/** Validate the entire package before the first write, then import attachments
 * and row chunks. Each chunk is its own journal run, keyed by the manifest digest
 * and the chunk's file and digest, so a rerun replays committed rows and an interrupted run
 * resumes at its first uncommitted group. The target is {env, renew?}; renew runs
 * between waves of work, when nothing is in flight. Without a target it plans
 * every chunk. A delta swept after the legacy retire takes the retire's marker
 * (retireMarker, epoch ms): every contact row is read through it (retire-marker.mjs). Every package
 * with a target (a delta or a full package) takes its workspace's lease before it plans (takeDeltaLease,
 * legacy-import/lease.ts): it waits while an erasure of the workspace runs, holds the lease (renewed on a
 * timer) through its last write, uploads included, and releases it at the end, so no erasure runs while it
 * writes. Under the lease it reads the workspace's erased contacts (a delta in its plan): their rows are
 * journaled as erasure leaves them, their files are never uploaded, and one an earlier run left in R2 is
 * removed (objects.mjs). */
// Tables other rows are mapped through can never be left out.
const contextTables=new Set(['projects','users','ais','ai_defaults','contacts','conversations','messages','mediables','media','datasets','dataset_files']);
export async function importPackage(root,target,modules,{expectManifestSha256,excludeTables=[],concurrency=1,progress=()=>{},retireMarker,history={}}={}){
  const {planImport,importLegacy,importDelta,planDelta,takeDeltaLease,readErased,erasedMediaOf,heldByNativeMedia,tableOrder,relationships,types}=modules;
  const started=Date.now(),{manifest,digest}=await readManifest(root,expectManifestSha256),delta=isDelta(manifest);
  if(delta&&!manifest.source.projectId)throw Error('A delta package names its legacy project (source.projectId)');
  // A full package is applied under its workspace's lease too; it names its workspace as every export does (extract.mjs).
  if(target&&!manifest.source.projectId)throw Error('A legacy package applied to a target names its legacy project (source.projectId)');
  if(retireMarker!==undefined&&!delta)throw Error('--retire-marker applies only to a delta package (snapshot --since)');
  if(delta&&(history.leaveUnread||history.publishDefaultRules))throw Error('--leave-unread and --publish-default-rules apply only to a full package: a delta never marks anything read or touches a workspace rule');
  progress({step:'verify',manifestSha256:digest,chunks:manifest.chunks.length,objects:manifest.objects.length,...(delta?{since:manifest.source.since}:{})});
  const sourceCounts=await verifyPackage(root,manifest),excluded=Object.fromEntries(excludeTables.map(table=>{if(!Object.hasOwn(manifest.source.rowCounts,table)||contextTables.has(table))throw Error(`Cannot leave out table ${table}`);return [table,manifest.source.rowCounts[table]];}));
  progress({step:'context',seconds:seconds(started)});
  const index=await packageContext(root,manifest,{timestamp:types.timestamp,...relationships},{delta,retireMarker});
  try{
    const runId=`legacy-package:${digest}`,options={context:index.context,objectKeys:index.objectKeys},tables={},conflicts=[];
    let objects={uploaded:0,present:0,removed:0},lease,erased,erasedMedia;const env=()=>target?.env,workspaces=new Set(delta?[String(manifest.source.projectId)]:[]);
    const order=table=>{const i=tableOrder.indexOf(table);return i<0?1000:i};
    // A chunk is identified by its file and digest, never by its place in the order.
    const chunks=manifest.chunks.filter(part=>!Object.hasOwn(excluded,part.table)).sort((a,b)=>order(a.table)-order(b.table)).map(part=>({part,chunk:part.file}));
    // Every row chunk is read through the retire marker, so its journal run, digests and decisions see the normalised rows.
    const read=async part=>unmarkRetired(part.table,await readPart(root,part),retireMarker);
    const bundleOf=(part,rows)=>chunkBundle(manifest,digest,part,rows,retireMarker);
    const chunkRun=async(part,rows)=>`legacy:${await types.digest(types.stable(bundleOf(part,rows)))}`;
    // A delta is applied update-aware (importDelta), from a plan made before the first write.
    const apply=delta?(bundle,extra={})=>importDelta(env(),bundle,{...options,...extra,plan:options.plan,lease,projectId:String(manifest.source.projectId)}):(bundle,extra={})=>importLegacy(env(),bundle,{...options,...history,...extra,erased,lease});

    // An import holds its workspace's lease from before its plan through its last write.
    try{
    if(target){
      lease=await takeDeltaLease(()=>target.env.DB,String(manifest.source.projectId),progress);progress({step:'lease',seconds:seconds(started)});
      // Which contacts are erased or being erased is read under the lease, so no erasure starts after it.
      if(delta){options.plan=await deltaPlan(root,manifest,target,{planDelta,context:index.context,chunks,chunkRun});erasedMedia=options.plan.erasedMedia;progress({step:'plan',seconds:seconds(started),heldConversations:options.plan.heldIn.size,withheldObjects:options.plan.withheldMedia.size});}
      else{({erased,erasedMedia}=await erasedScope(root,manifest,target,{readErased,erasedMediaOf,context:index.context}));if(erased.size)progress({step:'erased',contacts:erased.size,objects:erasedMedia.size});}
      // Walk all chunks read-only first, including late-table conflicts. A
      // resumable outage can commit chunks; a known conflict commits none.
      for(const {part} of chunks){
        const {rows}=await read(part);
        await apply(bundleOf(part,rows),{checkOnly:true});
        await target.renew?.();
      }
      const existing=await env().DB.prepare('SELECT bundle_digest FROM legacy_import_runs WHERE id=?').bind(runId).first();
      if(existing&&existing.bundle_digest!==digest)throw Error('Import digest conflict');
      // Object validation also precedes all writes, including the run journal.
      // Media rows are journaled in their chunks' runs; erased attachments are read from those runs by key.
      const mediaRuns=await Promise.all(manifest.chunks.filter(part=>part.table==='media').map(async part=>chunkRun(part,(await read(part)).rows)));
      const withheld=options.plan?.withheldMedia;
      await importObjects(target,root,manifest,runId,{concurrency,checkOnly:true,mediaRuns,withheld,erasedMedia,heldByNativeMedia,lease});
      await env().DB.prepare("INSERT OR IGNORE INTO legacy_import_runs VALUES(?,?,?,'running',?,NULL)").bind(runId,types.stable(manifest.source),digest,Date.now()).run();
      progress({step:'objects',seconds:seconds(started)});
      objects=await importObjects(target,root,manifest,runId,{concurrency,progress,mediaRuns,withheld,erasedMedia,heldByNativeMedia,lease});
    }
    // Parent tables finish before their children start; chunks of one table are independent.
    for(const table of [...new Set(chunks.map(c=>c.part.table))]){
      const queue=chunks.filter(c=>c.part.table===table),total=tables[table]={sourceRows:0,mappedRows:0,archivedOnly:0,holds:0,applied:0,replayed:0,...(delta&&target?emptyDeltaTotals():{erased:0}),...(retireMarker!==undefined?{ignoredRetireMarker:0}:{})};
      const one=async({part,chunk})=>{const begun=Date.now();
        const {rows,ignored}=await read(part);if(table==='projects')for(const row of rows)workspaces.add(String(row.id));
        if(retireMarker!==undefined)total.ignoredRetireMarker+=ignored;
        const bundle=bundleOf(part,rows);
        const result=target?await apply(bundle):{...(await planImport(bundle,options)).summary,applied:0,replayed:0};
        total.mappedRows+=result.mappedRows;total.holds+=result.holds.length;total.applied+=result.applied;
        if(delta&&target){addDeltaTotals(total,result);total.archivedOnly=total.archived_only;conflicts.push(...result.conflicts);}
        else{total.sourceRows+=result.sourceRows;total.archivedOnly+=result.archivedOnly.length;total.replayed+=result.replayed;total.erased+=result.erased||0;}
        progress({chunk,table,rows:result.sourceRows,applied:result.applied,replayed:result.replayed,ms:Date.now()-begun,...(result.conflicts?{conflicts:result.conflicts.length}:{}),...(result.d1Ms===undefined?{}:{d1Ms:result.d1Ms,maxBatchMs:result.maxBatchMs})});
      };
      await inWaves(queue,concurrency,one,target);
    }
    // A delta's rerun changes nothing, its run row included.
    if(target)await env().DB.prepare(`UPDATE legacy_import_runs SET state='complete',completed_at=? WHERE id=?${delta?" AND state<>'complete'":''}`).bind(Date.now(),runId).run();
    }finally{await lease?.release();}
    const sum=key=>Object.values(tables).reduce((n,t)=>n+t[key],0);
    return {id:runId,manifestSha256:digest,projectId:manifest.source.projectId,workspaces:[...workspaces],sourceRows:sum('sourceRows'),packageRows:Object.values(sourceCounts).reduce((n,c)=>n+c,0),excluded,mappedRows:sum('mappedRows'),archivedOnly:sum('archivedOnly'),holds:sum('holds'),applied:sum('applied'),replayed:sum('replayed'),...(retireMarker!==undefined?{ignoredRetireMarker:Object.values(tables).reduce((n,t)=>n+(t.ignoredRetireMarker||0),0)}:{}),objects:manifest.objects.length,objectsUploaded:objects.uploaded,objectsPresent:objects.present,objectsRemoved:objects.removed,...(delta?{}:{erased:sum('erased')}),mediaBytes:manifest.mediaBytes,sessions:target?.sessions,seconds:seconds(started),tables,
      ...(delta&&target?deltaSummary(manifest,tables,conflicts,options.plan.withheldMedia.size):{})};
  }finally{await index.close();}
}
/** A full package's erased contacts, read under its lease, and their media in the package: with none, one query. Media
 * rows are read from the package's media chunks and assigned through the package context (delta-scope.ts `contactsOf`). */
async function erasedScope(root,manifest,target,{readErased,erasedMediaOf,context}){
  const erased=await readErased(target.env.DB,String(manifest.source.projectId)),erasedMedia=new Set();
  if(erased.size)for(const part of manifest.chunks.filter(part=>part.table==='media')){for(const id of erasedMediaOf(erased,await readPart(root,part),context))erasedMedia.add(id);await target.renew?.();}
  return {erased,erasedMedia};
}
const seconds=since=>Math.round((Date.now()-since)/100)/10;
// The bundle one chunk is imported as. Its digest names the chunk's own journal run, so a repeat of the same package
// reproduces the same run ids. A delta's chunks say so, so no full import path ever applies one. A contacts chunk read
// through a retire marker records it (ISO), so a marker sweep is its own run and its run row shows the marker.
const chunkBundle=(manifest,digest,part,rows,retireMarker)=>({format:'happytohelp-legacy-v1',source:{repository:manifest.source.repository,revision:manifest.source.revision,exportedAt:manifest.source.exportedAt,projectId:manifest.source.projectId,package:digest,chunk:part.file,table:part.table,chunkSha256:part.sha256,...(isDelta(manifest)?{delta:true}:{}),...(retireMarker!==undefined&&part.table==='contacts'?{retireMarker:new Date(retireMarker).toISOString()}:{})},tables:{[part.table]:rows}});
