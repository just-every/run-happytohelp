import type {Env} from '../../platform/env'
export const businessErasureCount="(SELECT count(*) FROM business_links WHERE project_id=?1 AND contact_id=?2)+(SELECT count(*) FROM business_actions WHERE project_id=?1 AND conversation_id IN (SELECT id FROM conversations WHERE project_id=?1 AND contact_id=?2))"
export function businessErasureStatements(env:Env,projectId:string,contactId:string){const bound=(sql:string)=>env.DB.prepare(sql).bind(projectId,contactId);return [
 bound(`INSERT INTO erasure_requests(id,project_id,contact_id,store,destination_id,state,detail,requested_at,settled_at) SELECT lower(hex(randomblob(16))),?1,?2,'business:'||bc.provider,'','unsupported','Remove customer data at the source provider separately. Financial records may have provider retention requirements; local erasure does not delete or reverse them.',unixepoch()*1000,unixepoch()*1000 FROM business_links bl JOIN business_connections bc ON bc.id=bl.connection_id WHERE bl.project_id=?1 AND bl.contact_id=?2 GROUP BY bc.provider`),
 bound('DELETE FROM business_actions WHERE project_id=?1 AND conversation_id IN (SELECT id FROM conversations WHERE project_id=?1 AND contact_id=?2)'),
 bound('DELETE FROM business_links WHERE project_id=?1 AND contact_id=?2'),
]}
