import {readManifest} from '../package.mjs';
import {verifyAttachments} from './attachments.mjs';

// D1 answers "overloaded" when queries spend its resources within a 10-second window; waiting past it lets the next one run.
export const overloadWaits=[2000,4000,8000,16000,32000];
const statuses={mapped:'added',updated:'changed',unchanged:'unchanged',conflict:'conflicts',kept:'kept',erased:'erased',skipped:'skipped',archived_only:'archivedOnly'};

/** After a delta import: every row of the delta is journaled by the delta's own runs; the project's
 * journaled source rows (distinct table and id across all its runs) equal the previous total plus
 * the delta's rows no earlier run journaled; and every attachment the delta applied is identical in
 * R2. Counts and ids only. Each query reads one run through the journal's keys, and tells whether another of the
 * project's runs journaled a row through the journal's source index and that run's row, so it reads a few rows per
 * journal row however many runs the project has. A D1 "overloaded" answer is retried after each of overloadWaits. */
export async function checkDelta(target,root,{previousTotal,excludeTables=[]}){
  if(!Number.isSafeInteger(previousTotal)||previousTotal<0)throw Error('--previous-total is the projectSourceRows the previous check printed (a non-negative integer)');
  const {manifest,digest}=await readManifest(root),project=String(manifest.source.projectId);
  if(typeof manifest.source.since!=='string')throw Error('Not a delta package: export it with snapshot --since');
  let retries=0;
  const q=async(sql,...args)=>{
    for(let attempt=0;;attempt++){
      try{return (await target.env.DB.prepare(sql).bind(...args).all()).results;}
      catch(error){
        if(!/overloaded/i.test(String(error?.message))||attempt>=overloadWaits.length)throw error;
        retries++;process.stderr.write(JSON.stringify({at:new Date().toISOString(),check:'delta',retry:attempt+1,waitSeconds:overloadWaits[attempt]/1000})+'\n');
        await new Promise(resolve=>setTimeout(resolve,overloadWaits[attempt]));
      }
    }
  };
  // Whether a journal row e belongs to another run of this project (by the run's own source), read through e's run row.
  const ofProject="(SELECT json_extract(u.source_json,'$.projectId') FROM legacy_import_runs u WHERE u.id=e.run_id)=?";
  const deltaRuns=(await q("SELECT id FROM legacy_import_runs WHERE json_extract(source_json,'$.package')=? ORDER BY id",digest)).map(r=>r.id);
  const projectRuns=(await q("SELECT id FROM legacy_import_runs WHERE json_extract(source_json,'$.projectId')=? ORDER BY id",project)).map(r=>r.id);
  const journal={};let newRows=0,projectSourceRows=0;
  for(const run of deltaRuns){
    for(const r of await q('SELECT source_table t,status s,COUNT(*) n FROM legacy_import_rows WHERE run_id=? GROUP BY 1,2',run)){const t=journal[r.t]??={journaled:0};t.journaled+=r.n;const key=statuses[r.s]??r.s;t[key]=(t[key]||0)+r.n;}
    // Rows of this delta that no run before it journaled.
    newRows+=(await q(`SELECT COUNT(*) n FROM legacy_import_rows r WHERE r.run_id=? AND NOT EXISTS(SELECT 1 FROM legacy_import_rows e WHERE e.source_table=r.source_table AND e.source_id=r.source_id AND ${ofProject} AND (SELECT COALESCE(json_extract(u.source_json,'$.package'),'') FROM legacy_import_runs u WHERE u.id=e.run_id)<>?)`,run,project,digest))[0].n;
    await target.renew?.();
  }
  // Distinct source rows across all of the project's runs: each counted in the first run that journaled it.
  for(const run of projectRuns){
    projectSourceRows+=(await q(`SELECT COUNT(*) n FROM legacy_import_rows r WHERE r.run_id=? AND NOT EXISTS(SELECT 1 FROM legacy_import_rows e WHERE e.source_table=r.source_table AND e.source_id=r.source_id AND e.rowid<r.rowid AND ${ofProject})`,run,project))[0].n;
    await target.renew?.();
  }
  const tables=Object.fromEntries(Object.entries(manifest.source.rowCounts).map(([table,rows])=>[table,{delta:rows,journaled:0,added:0,changed:0,unchanged:0,conflicts:0,kept:0,erased:0,skipped:0,archivedOnly:0,...journal[table]}]));
  const unjournaled=Object.entries(tables).filter(([table,t])=>!excludeTables.includes(table)&&t.journaled!==t.delta).map(([table])=>table);
  // Each conflict the delta's runs recorded, by table, id and reason (no content); `conflicts` counts them.
  const conflictRows=[];
  for(const run of deltaRuns)conflictRows.push(...(await q('SELECT source_table sourceTable,source_id sourceId,target_table targetTable,target_key targetKey,reason FROM legacy_import_conflicts WHERE run_id=? ORDER BY 1,2,3,4',run)).map(c=>({...c})));
  const conflicts=conflictRows.length;
  // Files of erased contacts, of held rows and of mail the seed already took are withheld by design; every other one must be in R2.
  const withheld=new Set();
  // Through the run's own key: the source index would read every media row the journal holds.
  for(const run of deltaRuns)for(const r of await q("SELECT source_id FROM legacy_import_rows WHERE run_id=? AND +source_table='media' AND status IN ('erased','conflict','skipped')",run))withheld.add(String(r.source_id));
  const attachments=await verifyAttachments(target,root,{skip:withheld});
  const expectedTotal=previousTotal+newRows;
  const ok=deltaRuns.length>0&&!unjournaled.length&&projectSourceRows===expectedTotal&&attachments.mismatched===0;
  return {ok,projectId:project,manifestSha256:digest,since:manifest.source.since,watermark:manifest.source.watermark??null,deltaRuns:deltaRuns.length,projectRuns:projectRuns.length,
    journalEqualsDelta:!unjournaled.length,unjournaled,previousTotal,newRows,expectedTotal,projectSourceRows,conflicts,conflictRows,retries,skipped:Object.values(tables).reduce((n,t)=>n+t.skipped,0),tables,attachments:{...attachments,withheld:withheld.size}};
}
