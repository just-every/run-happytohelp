import {readManifest} from '../package.mjs';
import {verifyAttachments} from './attachments.mjs';

const statuses={mapped:'added',updated:'changed',unchanged:'unchanged',conflict:'conflicts',kept:'kept',erased:'erased',archived_only:'archivedOnly'};

/** After a delta import: every row of the delta is journaled by the delta's own runs; the project's
 * journaled source rows (distinct table and id across all its runs) equal the previous total plus
 * the delta's rows no earlier run journaled; and every attachment the delta applied is identical in
 * R2. Counts and ids only. Each query reads one run, through the journal's keys. */
export async function checkDelta(target,root,{previousTotal,excludeTables=[]}){
  if(!Number.isSafeInteger(previousTotal)||previousTotal<0)throw Error('--previous-total is the projectSourceRows the previous check printed (a non-negative integer)');
  const {manifest,digest}=await readManifest(root),project=String(manifest.source.projectId);
  if(typeof manifest.source.since!=='string')throw Error('Not a delta package: export it with snapshot --since');
  const q=async(sql,...args)=>(await target.env.DB.prepare(sql).bind(...args).all()).results;
  const deltaRuns=(await q("SELECT id FROM legacy_import_runs WHERE json_extract(source_json,'$.package')=? ORDER BY id",digest)).map(r=>r.id);
  const projectRuns=(await q("SELECT id FROM legacy_import_runs WHERE json_extract(source_json,'$.projectId')=? ORDER BY id",project)).map(r=>r.id);
  const deltaSet=new Set(deltaRuns),earlierRuns=JSON.stringify(projectRuns.filter(id=>!deltaSet.has(id))),allRuns=JSON.stringify(projectRuns);
  const journal={};let newRows=0,projectSourceRows=0;
  for(const run of deltaRuns){
    for(const r of await q('SELECT source_table t,status s,COUNT(*) n FROM legacy_import_rows WHERE run_id=? GROUP BY 1,2',run)){const t=journal[r.t]??={journaled:0};t.journaled+=r.n;const key=statuses[r.s]??r.s;t[key]=(t[key]||0)+r.n;}
    // Rows of this delta that no run before it journaled.
    newRows+=(await q("SELECT COUNT(*) n FROM legacy_import_rows r WHERE r.run_id=? AND NOT EXISTS(SELECT 1 FROM legacy_import_rows e WHERE e.source_table=r.source_table AND e.source_id=r.source_id AND e.run_id IN (SELECT value FROM json_each(?)))",run,earlierRuns))[0].n;
    await target.renew?.();
  }
  // Distinct source rows across all of the project's runs: each counted in the first run that journaled it.
  for(const run of projectRuns){
    projectSourceRows+=(await q("SELECT COUNT(*) n FROM legacy_import_rows r WHERE r.run_id=? AND NOT EXISTS(SELECT 1 FROM legacy_import_rows e WHERE e.source_table=r.source_table AND e.source_id=r.source_id AND e.rowid<r.rowid AND e.run_id IN (SELECT value FROM json_each(?)))",run,allRuns))[0].n;
    await target.renew?.();
  }
  const tables=Object.fromEntries(Object.entries(manifest.source.rowCounts).map(([table,rows])=>[table,{delta:rows,journaled:0,added:0,changed:0,unchanged:0,conflicts:0,kept:0,erased:0,archivedOnly:0,...journal[table]}]));
  const unjournaled=Object.entries(tables).filter(([table,t])=>!excludeTables.includes(table)&&t.journaled!==t.delta).map(([table])=>table);
  const conflicts=deltaRuns.length?(await Promise.all(deltaRuns.map(run=>q('SELECT COUNT(*) n FROM legacy_import_conflicts WHERE run_id=?',run)))).reduce((n,[r])=>n+r.n,0):0;
  // Files of erased contacts and of held rows are withheld by design; every other one must be in R2.
  const withheld=new Set();
  for(const run of deltaRuns)for(const r of await q("SELECT source_id FROM legacy_import_rows WHERE run_id=? AND source_table='media' AND status IN ('erased','conflict')",run))withheld.add(String(r.source_id));
  const attachments=await verifyAttachments(target,root,{skip:withheld});
  const expectedTotal=previousTotal+newRows;
  const ok=deltaRuns.length>0&&!unjournaled.length&&projectSourceRows===expectedTotal&&attachments.mismatched===0;
  return {ok,projectId:project,manifestSha256:digest,since:manifest.source.since,watermark:manifest.source.watermark??null,deltaRuns:deltaRuns.length,projectRuns:projectRuns.length,
    journalEqualsDelta:!unjournaled.length,unjournaled,previousTotal,newRows,expectedTotal,projectSourceRows,conflicts,tables,attachments:{...attachments,withheld:withheld.size}};
}
