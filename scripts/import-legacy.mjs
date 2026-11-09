#!/usr/bin/env node
import {registerHooks} from 'node:module'
import {existsSync} from 'node:fs'
import {readFile} from 'node:fs/promises'
registerHooks({resolve(specifier,context,next){if(specifier.startsWith('.')&&context.parentURL){const url=new URL(specifier+'.ts',context.parentURL);if(existsSync(url))return next(url.href,context)}return next(specifier,context)}})
const usage='Usage: node scripts/import-legacy.mjs (--file export.json | --package package-directory) [--apply [--persist-to path | --remote --database D1-NAME --bucket R2-NAME]] [--expect-manifest-sha256 HEX] [--exclude-table TABLE ...] [--concurrency N] [--retire-marker "YYYY-MM-DD HH:MM:SS" (delta package only)]. Without --apply it validates and plans without writing.'
const args=process.argv.slice(2),value=name=>{const i=args.indexOf(name);if(i<0)return undefined;const v=args[i+1];if(!v||v.startsWith('--'))throw new Error(usage);return v}
const file=value('--file'),pkg=value('--package'),remote=args.includes('--remote'),apply=args.includes('--apply'),excludeTables=args.flatMap((arg,i)=>arg==='--exclude-table'?[args[i+1]]:[])
if(excludeTables.some(table=>!table||table.startsWith('--'))||(excludeTables.length&&!pkg))throw new Error(usage)
if(!file===!pkg||(remote&&!apply)||(remote&&args.includes('--persist-to'))||(file&&remote))throw new Error(usage)
// The sweep after the legacy retire passes the retire's marker time (scripts/legacy-import/retire-marker.mjs).
// It is refused before anything is read from or written to D1/R2: malformed, with --file, or for a full package.
const {parseRetireMarker}=await import('./legacy-import/retire-marker.mjs')
const retireMarker=args.includes('--retire-marker')?parseRetireMarker(value('--retire-marker')):undefined
if(retireMarker!==undefined&&file)throw new Error(usage)
if(retireMarker!==undefined){const {readManifest}=await import('./legacy-import/package.mjs'),{isDelta}=await import('./legacy-import/delta-package.mjs');if(!isDelta((await readManifest(pkg)).manifest))throw new Error('--retire-marker applies only to a delta package (snapshot --since)')}
const {planImport,importLegacy}=await import('../src/modules/legacy-import/importer.ts')
const {importDelta}=await import('../src/modules/legacy-import/delta.ts')
const {planDelta}=await import('../src/modules/legacy-import/delta-plan.ts')
// Every import writes only under its workspace's lease: never while an erasure there runs (lease.ts). Under it, the
// workspace's erased contacts are read (erased.ts): their rows are journaled as erasure leaves them, their files never uploaded.
const {takeDeltaLease}=await import('../src/modules/legacy-import/lease.ts')
const {readErased,erasedMediaOf,heldByNativeMedia}=await import('../src/modules/legacy-import/erased.ts')
const {tableOrder}=await import('../src/modules/legacy-import/mapping.ts')
const relationships=await import('../src/modules/legacy-import/relationships.ts')
const types=await import('../src/modules/legacy-import/types.ts')
const {importPackage}=await import('./legacy-import/import-package.mjs')
const {localTarget,remoteTarget}=await import('./legacy-import/target.mjs')
const {indexImportedKnowledge}=await import('./legacy-import/knowledge-index.mjs')
const {updateKnowledgeIndex}=await import('../src/modules/knowledge/canonicaliser.ts')
const concurrency=Number(value('--concurrency')??1);if(!Number.isSafeInteger(concurrency)||concurrency<1||concurrency>16)throw new Error(usage)
// Wrangler announces each remote connection on stdout; the command's stdout is its summary alone.
process.env.WRANGLER_LOG??='warn'
// Progress is one JSON line per step or chunk on stderr: counts, ids and timings only.
const progress=line=>process.stderr.write(JSON.stringify({at:new Date().toISOString(),...line})+'\n')
// A killed run cannot delete its private index of package rows; the next run does.
const {removeStaleDirectories}=await import('./legacy-import/scratch.mjs')
const stale=await removeStaleDirectories();if(stale.length)progress({step:'removed-stale',directories:stale.length})
let bundleProjects
async function run(target){
 if(pkg)return importPackage(pkg,target,{planImport,importLegacy,importDelta,planDelta,takeDeltaLease,readErased,erasedMediaOf,heldByNativeMedia,tableOrder,relationships,types},{expectManifestSha256:value('--expect-manifest-sha256'),excludeTables,concurrency,progress,retireMarker})
 const bundle=JSON.parse(await readFile(file,'utf8'));bundleProjects=bundle.tables?.projects
 if(!target){const plan=await planImport(bundle);return {id:plan.id,...plan.summary}}
 // The bundle names its workspace as every export does (extract.mjs); refused before any write without it.
 const projectId=bundle.source?.projectId;if(!projectId)throw new Error('A legacy export applied to a target names its legacy project (source.projectId)')
 const lease=await takeDeltaLease(()=>target.env.DB,String(projectId),progress)
 try{
  const erased=await readErased(target.env.DB,String(projectId))
  if(erased.size)progress({step:'erased',contacts:erased.size,objects:erasedMediaOf(erased,bundle.tables?.media??[],bundle).size})
  return await importLegacy(target.env,bundle,{erased,lease})
 }finally{await lease.release()}
}
if(!apply)console.log(JSON.stringify(await run(null),null,2))
else{
 const target=remote?await remoteTarget({database:value('--database'),bucket:value('--bucket')}):await localTarget(value('--persist-to')??'.wrangler/state')
 progress({step:'target',target:target.label})
 try{
  const summary=await run(target)
  // Index imported knowledge before the workspace is used (see knowledge-index.mjs).
  const {workspaces=(bundleProjects??[]).map(row=>String(row.id))}=summary;delete summary.workspaces
  summary.knowledgeIndex=await indexImportedKnowledge(target,workspaces,updateKnowledgeIndex,{progress})
  console.log(JSON.stringify(summary,null,2))
 }finally{await target.close()}
}
