import {inWaves,readManifest,readPart,verifyPackage} from './package.mjs';
import {packageContext} from './context-index.mjs';
import {importObjects} from './objects.mjs';

/** Validate the entire package before the first write, then import attachments
 * and row chunks. Each chunk is its own journal run, keyed by the manifest digest
 * and the chunk's file and digest, so a rerun replays committed rows and an interrupted run
 * resumes at its first uncommitted group. The target is {env, renew?}; renew runs
 * between waves of work, when nothing is in flight. Without a target it plans
 * every chunk. */
// Tables other rows are mapped through can never be left out.
const contextTables=new Set(['projects','users','ais','ai_defaults','contacts','conversations','messages','mediables','media','datasets','dataset_files']);
export async function importPackage(root,target,modules,{expectManifestSha256,excludeTables=[],concurrency=1,progress=()=>{}}={}){
  const {planImport,importLegacy,tableOrder,relationships,types}=modules;
  const started=Date.now(),{manifest,digest}=await readManifest(root,expectManifestSha256);
  progress({step:'verify',manifestSha256:digest,chunks:manifest.chunks.length,objects:manifest.objects.length});
  const sourceCounts=await verifyPackage(root,manifest),excluded=Object.fromEntries(excludeTables.map(table=>{if(!Object.hasOwn(manifest.source.rowCounts,table)||contextTables.has(table))throw Error(`Cannot leave out table ${table}`);return [table,manifest.source.rowCounts[table]];}));
  progress({step:'context',seconds:seconds(started)});
  const index=await packageContext(root,manifest,{timestamp:types.timestamp,...relationships});
  try{
    const runId=`legacy-package:${digest}`,options={context:index.context,objectKeys:index.objectKeys},tables={};
    let objects={uploaded:0,present:0};const env=()=>target?.env;
    const order=table=>{const i=tableOrder.indexOf(table);return i<0?1000:i};
    // A chunk is identified by its file and digest, never by its place in the order.
    const chunks=manifest.chunks.filter(part=>!Object.hasOwn(excluded,part.table)).sort((a,b)=>order(a.table)-order(b.table)).map(part=>({part,chunk:part.file}));

    if(target){
      // Walk all chunks read-only first, including late-table conflicts. A
      // resumable outage can commit chunks; a known conflict commits none.
      for(const {part,chunk} of chunks){
        const rows=await readPart(root,part),table=part.table;
        const bundle={format:'happytohelp-legacy-v1',source:{repository:manifest.source.repository,revision:manifest.source.revision,exportedAt:manifest.source.exportedAt,projectId:manifest.source.projectId,package:digest,chunk,table,chunkSha256:part.sha256},tables:{[table]:rows}};
        await importLegacy(env(),bundle,{...options,checkOnly:true});
        await target.renew?.();
      }
      const existing=await env().DB.prepare('SELECT bundle_digest FROM legacy_import_runs WHERE id=?').bind(runId).first();
      if(existing&&existing.bundle_digest!==digest)throw Error('Import digest conflict');
      // Object validation also precedes all writes, including the run journal.
      await importObjects(target,root,manifest,runId,{concurrency,checkOnly:true});
      await env().DB.prepare("INSERT OR IGNORE INTO legacy_import_runs VALUES(?,?,?,'running',?,NULL)").bind(runId,types.stable(manifest.source),digest,Date.now()).run();
      progress({step:'objects',seconds:seconds(started)});
      objects=await importObjects(target,root,manifest,runId,{concurrency,progress});
    }
    // Parent tables finish before their children start; chunks of one table are independent.
    for(const table of [...new Set(chunks.map(c=>c.part.table))]){
      const queue=chunks.filter(c=>c.part.table===table),total=tables[table]={sourceRows:0,mappedRows:0,archivedOnly:0,holds:0,applied:0,replayed:0};
      const one=async({part,chunk})=>{const begun=Date.now();
        const rows=await readPart(root,part);
        const bundle={format:'happytohelp-legacy-v1',source:{repository:manifest.source.repository,revision:manifest.source.revision,exportedAt:manifest.source.exportedAt,projectId:manifest.source.projectId,package:digest,chunk,table,chunkSha256:part.sha256},tables:{[table]:rows}};
        const result=target?await importLegacy(env(),bundle,options):{...(await planImport(bundle,options)).summary,applied:0,replayed:0};
        total.sourceRows+=result.sourceRows;total.mappedRows+=result.mappedRows;total.archivedOnly+=result.archivedOnly.length;total.holds+=result.holds.length;total.applied+=result.applied;total.replayed+=result.replayed;
        progress({chunk,table,rows:result.sourceRows,applied:result.applied,replayed:result.replayed,ms:Date.now()-begun,...(result.d1Ms===undefined?{}:{d1Ms:result.d1Ms,maxBatchMs:result.maxBatchMs})});
      };
      await inWaves(queue,concurrency,one,target);
    }
    if(target)await env().DB.prepare("UPDATE legacy_import_runs SET state='complete',completed_at=? WHERE id=?").bind(Date.now(),runId).run();
    const sum=key=>Object.values(tables).reduce((n,t)=>n+t[key],0);
    return {id:runId,manifestSha256:digest,projectId:manifest.source.projectId,sourceRows:sum('sourceRows'),packageRows:Object.values(sourceCounts).reduce((n,c)=>n+c,0),excluded,mappedRows:sum('mappedRows'),archivedOnly:sum('archivedOnly'),holds:sum('holds'),applied:sum('applied'),replayed:sum('replayed'),objects:manifest.objects.length,objectsUploaded:objects.uploaded,objectsPresent:objects.present,mediaBytes:manifest.mediaBytes,sessions:target?.sessions,seconds:seconds(started),tables};
  }finally{await index.close();}
}
const seconds=since=>Math.round((Date.now()-since)/100)/10;
