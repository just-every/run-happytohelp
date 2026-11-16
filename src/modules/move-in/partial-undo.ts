import type {Env} from '../../platform/env'
import type {Run} from './types'
import {updateRun} from './run-store'
import {undoProgress} from './undo-progress'
/** Reviewed children that never acquired a job have no native effects to
 * reverse. Record that fact so undo can reach the already committed children. */
export async function skipUnstartedUndo(env:Env,run:Run,ordinal:number){
 const progress=await undoProgress(env,run)
 const remaining=await env.DB.prepare("SELECT COUNT(*) total FROM move_in_batches WHERE run_id=? AND ordinal<>? AND state<>'undone'").bind(run.id,ordinal).first<{total:number}>()
 const state=remaining?.total?'undoing':'undone'
 await updateRun(env,run,{state,cursor:progress.checkpoint,error:null,report_json:JSON.stringify({state,...progress,referencesChecked:true})},[
  env.DB.prepare("UPDATE move_in_batches SET state='undone',checkpoint=0 WHERE run_id=? AND ordinal=? AND kit_job_id IS NULL").bind(run.id,ordinal)
 ])
}
