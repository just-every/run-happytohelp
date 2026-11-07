import {inWaves,readManifest,readPart,verifyPackage} from './package.mjs';
import {packageContext} from './context-index.mjs';
import {importObjects} from './objects.mjs';
import {isDelta,deltaPlan,emptyDeltaTotals,addDeltaTotals,deltaSummary} from './delta-package.mjs';

/** Validate the entire package before the first write, then import attachments
 * and row chunks. Each chunk is its own journal run, keyed by the manifest digest
 * and the chunk's file and digest, so a rerun replays committed rows and an interrupted run
 * resumes at its first uncommitted group. The target is {env, renew?}; renew runs
 * between waves of work, when nothing is in flight. Without a target it plans
 * every chunk. */
// Tables other rows are mapped through can never be left out.
const contextTables=new Set(['projects','users','ais','ai_defaults','contacts','conversations','messages','mediables','media','datasets','dataset_files']);
export async function importPackage(root,target,modules,{expectManifestSha256,excludeTables=[],concurrency=1,progress=()=>{}}={}){
  const {planImport,importLegacy,importDelta,planDelta,tableOrder,relationships,types}=modules;
  const started=Date.now(),{manifest,digest}=await readManifest(root,expectManifestSha256),delta=isDelta(manifest);
  if(delta&&!manifest.source.projectId)throw Error('A delta package names its legacy project (source.projectId)');
  progress({step:'verify',manifestSha256:digest,chunks:manifest.chunks.length,objects:manifest.objects.length,...(delta?{since:manifest.source.since}:{})});
  const sourceCounts=await verifyPackage(root,manifest),excluded=Object.fromEntries(excludeTables.map(table=>{if(!Object.hasOwn(manifest.source.rowCounts,table)||contextTables.has(table))throw Error(`Cannot leave out table ${table}`);return [table,manifest.source.rowCounts[table]];}));
  progress({step:'context',seconds:seconds(started)});
  const index=await packageContext(root,manifest,{timestamp:types.timestamp,...relationships},{delta});
  try{
    const runId=`legacy-package:${digest}`,options={context:index.context,objectKeys:index.objectKeys},tables={},conflicts=[];
    let objects={uploaded:0,present:0};const env=()=>target?.env,workspaces=new Set(delta?[String(manifest.source.projectId)]:[]);
    const order=table=>{const i=tableOrder.indexOf(table);return i<0?1000:i};
    // A chunk is identified by its file and digest, never by its place in the order.
    const chunks=manifest.chunks.filter(part=>!Object.hasOwn(excluded,part.table)).sort((a,b)=>order(a.table)-order(b.table)).map(part=>({part,chunk:part.file}));
    const chunkRun=async(part,rows)=>`legacy:${await types.digest(types.stable(chunkBundle(manifest,digest,part,rows)))}`;
    // A delta is applied update-aware (importDelta), from a plan made before the first write.
    const apply=delta?(bundle,extra={})=>importDelta(env(),bundle,{...options,...extra,plan:options.plan,projectId:String(manifest.source.projectId)}):(bundle,extra={})=>importLegacy(env(),bundle,{...options,...extra});

    if(target){
      if(delta){options.plan=await deltaPlan(root,manifest,target,{planDelta,context:index.context,chunks,chunkRun});progress({step:'plan',seconds:seconds(started),heldConversations:options.plan.heldIn.size,withheldObjects:options.plan.withheldMedia.size});}
      // Walk all chunks read-only first, including late-table conflicts. A
      // resumable outage can commit chunks; a known conflict commits none.
      for(const {part} of chunks){
        const rows=await readPart(root,part);
        await apply(chunkBundle(manifest,digest,part,rows),{checkOnly:true});
        await target.renew?.();
      }
      const existing=await env().DB.prepare('SELECT bundle_digest FROM legacy_import_runs WHERE id=?').bind(runId).first();
      if(existing&&existing.bundle_digest!==digest)throw Error('Import digest conflict');
      // Object validation also precedes all writes, including the run journal.
      // Media rows are journaled in their chunks' runs; erased attachments are read from those runs by key.
      const mediaRuns=await Promise.all(manifest.chunks.filter(part=>part.table==='media').map(async part=>chunkRun(part,await readPart(root,part))));
      const withheld=options.plan?.withheldMedia;
      await importObjects(target,root,manifest,runId,{concurrency,checkOnly:true,mediaRuns,withheld});
      await env().DB.prepare("INSERT OR IGNORE INTO legacy_import_runs VALUES(?,?,?,'running',?,NULL)").bind(runId,types.stable(manifest.source),digest,Date.now()).run();
      progress({step:'objects',seconds:seconds(started)});
      objects=await importObjects(target,root,manifest,runId,{concurrency,progress,mediaRuns,withheld});
    }
    // Parent tables finish before their children start; chunks of one table are independent.
    for(const table of [...new Set(chunks.map(c=>c.part.table))]){
      const queue=chunks.filter(c=>c.part.table===table),total=tables[table]={sourceRows:0,mappedRows:0,archivedOnly:0,holds:0,applied:0,replayed:0,...(delta&&target?emptyDeltaTotals():{})};
      const one=async({part,chunk})=>{const begun=Date.now();
        const rows=await readPart(root,part);if(table==='projects')for(const row of rows)workspaces.add(String(row.id));
        const bundle=chunkBundle(manifest,digest,part,rows);
        const result=target?await apply(bundle):{...(await planImport(bundle,options)).summary,applied:0,replayed:0};
        total.mappedRows+=result.mappedRows;total.holds+=result.holds.length;total.applied+=result.applied;
        if(delta&&target){addDeltaTotals(total,result);total.archivedOnly=total.archived_only;conflicts.push(...result.conflicts);}
        else{total.sourceRows+=result.sourceRows;total.archivedOnly+=result.archivedOnly.length;total.replayed+=result.replayed;}
        progress({chunk,table,rows:result.sourceRows,applied:result.applied,replayed:result.replayed,ms:Date.now()-begun,...(result.conflicts?{conflicts:result.conflicts.length}:{}),...(result.d1Ms===undefined?{}:{d1Ms:result.d1Ms,maxBatchMs:result.maxBatchMs})});
      };
      await inWaves(queue,concurrency,one,target);
    }
    // A delta's rerun changes nothing, its run row included.
    if(target)await env().DB.prepare(`UPDATE legacy_import_runs SET state='complete',completed_at=? WHERE id=?${delta?" AND state<>'complete'":''}`).bind(Date.now(),runId).run();
    const sum=key=>Object.values(tables).reduce((n,t)=>n+t[key],0);
    return {id:runId,manifestSha256:digest,projectId:manifest.source.projectId,workspaces:[...workspaces],sourceRows:sum('sourceRows'),packageRows:Object.values(sourceCounts).reduce((n,c)=>n+c,0),excluded,mappedRows:sum('mappedRows'),archivedOnly:sum('archivedOnly'),holds:sum('holds'),applied:sum('applied'),replayed:sum('replayed'),objects:manifest.objects.length,objectsUploaded:objects.uploaded,objectsPresent:objects.present,mediaBytes:manifest.mediaBytes,sessions:target?.sessions,seconds:seconds(started),tables,
      ...(delta&&target?deltaSummary(manifest,tables,conflicts,options.plan.withheldMedia.size):{})};
  }finally{await index.close();}
}
const seconds=since=>Math.round((Date.now()-since)/100)/10;
// The bundle one chunk is imported as. Its digest names the chunk's own journal run, so a repeat of the same package
// reproduces the same run ids. A delta's chunks say so, so no full import path ever applies one.
const chunkBundle=(manifest,digest,part,rows)=>({format:'happytohelp-legacy-v1',source:{repository:manifest.source.repository,revision:manifest.source.revision,exportedAt:manifest.source.exportedAt,projectId:manifest.source.projectId,package:digest,chunk:part.file,table:part.table,chunkSha256:part.sha256,...(isDelta(manifest)?{delta:true}:{})},tables:{[part.table]:rows}});
