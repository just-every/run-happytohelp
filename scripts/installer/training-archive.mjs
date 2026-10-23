// An evaluation can spend money. A portable history never carries permission
// to dispatch its unfinished cases on the receiving installation.
const pending=new Set(['planning','queued']);
export function trainingArchiveRow(table,row){
 if(table==='training_runs'&&(pending.has(row.status)||row.status==='running'))return {...row,status:row.status==='running'||row.reserved_cost>0?'uncertain':'cancelled'};
 if(table==='training_cases'&&['queued','running'].includes(row.status))return {...row,status:row.status==='running'?'uncertain':'cancelled',lease_expires_at:null,error:'Archived evaluation is never replayed'};
 return row;
}

export const trainingRestoreSql=`
UPDATE training_runs SET status=CASE WHEN status='running' OR reserved_cost>0 THEN 'uncertain' ELSE 'cancelled' END WHERE status IN ('planning','queued','running');
UPDATE training_cases SET status=CASE WHEN status='running' THEN 'uncertain' ELSE 'cancelled' END,lease_expires_at=NULL,error='Archived evaluation is never replayed' WHERE status IN ('queued','running');`;

// Older archives must be fenced in the staged copies as well. The commit that
// makes their rows visible must already contain these inactive states.
export async function trainingArchiveStagedSafety({db,tables}){
 const statements=trainingRestoreSql.split(';').map(sql=>sql.trim()).filter(Boolean).flatMap(sql=>{
  const table=sql.match(/^UPDATE (\w+) /)[1],copy=tables[table];
  return copy?[db.prepare(sql.replace(/^UPDATE \w+ /,`UPDATE "${copy.replaceAll('"','""')}" `))]:[];
 });
 if(statements.length)await db.batch(statements);
 return true;
}
