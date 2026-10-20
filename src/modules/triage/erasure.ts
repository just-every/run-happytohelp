import type {Env} from '../../platform/env'
const owned='SELECT id FROM conversations WHERE project_id=?1 AND contact_id=?2'
const jobs=`SELECT id FROM triage_jobs WHERE project_id=?1 AND conversation_id IN (${owned})`
export const triageErasureCount=`(SELECT count(*) FROM triage_jobs WHERE id IN (${jobs}))+(SELECT count(*) FROM triage_labels WHERE project_id=?1 AND conversation_id IN (${owned}))`
export function triageErasureStatements(env:Env,projectId:string,contactId:string){return [`DELETE FROM triage_usage WHERE job_id IN (${jobs})`,`DELETE FROM triage_labels WHERE project_id=?1 AND conversation_id IN (${owned})`,`DELETE FROM triage_jobs WHERE id IN (${jobs})`].map(sql=>env.DB.prepare(sql).bind(projectId,contactId))}
