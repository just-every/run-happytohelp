import type {Env} from '../../platform/env'
import type {Run} from './types'
/** Undo counts committed native changes, not source records (staff and unmapped
 * records have no native effect). Unstarted children contribute nothing. The
 * same journal query is used at admission, checkpoints and reload after a stop. */
export async function undoProgress(env:Env,run:Pick<Run,'id'>){
 const progress=await env.DB.prepare(`SELECT COUNT(*) total,COALESCE(SUM(reversed),0) checkpoint,
 COALESCE(SUM(reversed=1 AND json_extract(record_json,'$.before') IS NULL),0) removed,
 COALESCE(SUM(reversed=1 AND json_extract(record_json,'$.before') IS NOT NULL),0) restored
 FROM ik_provenance WHERE job_id IN (SELECT kit_job_id FROM move_in_batches WHERE run_id=?)`).bind(run.id).first<{total:number;checkpoint:number;removed:number;restored:number}>()
 if(!progress)throw new Error('import_undo_progress_missing')
 return {...progress,retained:progress.total-progress.checkpoint}
}
