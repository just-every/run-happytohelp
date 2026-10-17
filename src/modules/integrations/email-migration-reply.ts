import type {Env} from '../../platform/env'

/** An unmatched imported-vendor reply remains a normal customer ticket, visibly
 * marked with the workspace's ordinary portable tag. It never grants identity. */
export async function markPreMigrationReply(env:Env,projectId:string,conversationId:string){
 const name='Possible pre-migration reply',normalized=name.toLowerCase()
 await env.DB.batch([
  env.DB.prepare(`INSERT INTO workspace_tags(id,project_id,name,normalized_name) VALUES(?,?,?,?) ON CONFLICT(project_id,normalized_name) DO NOTHING`).bind(crypto.randomUUID(),projectId,name,normalized),
  env.DB.prepare(`INSERT OR IGNORE INTO conversation_tags(project_id,conversation_id,tag_id) SELECT c.project_id,c.id,t.id FROM conversations c JOIN workspace_tags t ON t.project_id=c.project_id AND t.normalized_name=? WHERE c.id=? AND c.project_id=?`).bind(normalized,conversationId,projectId),
 ])
}
