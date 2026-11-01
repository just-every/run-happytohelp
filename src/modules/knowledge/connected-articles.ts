import type {Env} from '../../platform/env'
import {HTTPException} from 'hono/http-exception'
import {memberAccess} from '../access/gate'
import {activeProjectSql,anonymousReaders,visibleCollectionsSql} from './door'

function denied():never{throw new HTTPException(403,{res:Response.json({error:{code:'SCOPE_DENIED',message:'SCOPE_DENIED'}},{status:403})})}
/** Connected reads retain native read-or-edit authority and role selection.
 * Mutations separately require the grant’s current edit/publish permissions. */
export async function connectedArticleSnapshot(env:Env,projectId:string,articleId:string,principalId:string){
 const access=await memberAccess(env.DB,projectId,principalId)
 if(!(access?.permissions.has('knowledge.read')||access?.permissions.has('knowledge.edit'))||(access.knowledgeArticleIds!==null&&!access.knowledgeArticleIds.includes(articleId)))denied()
 const authority=`EXISTS(SELECT 1 FROM memberships m LEFT JOIN member_roles mr ON mr.project_id=m.project_id AND mr.user_id=m.user_id LEFT JOIN project_roles pr ON pr.project_id=m.project_id AND pr.id=mr.role_key WHERE m.project_id=a.project_id AND m.user_id=? AND (m.role='owner' OR mr.role_key IS NULL AND m.role IN ('admin','operator') OR pr.base IN ('admin','operator') AND EXISTS(SELECT 1 FROM json_each(pr.permissions_json) WHERE value IN ('knowledge.read','knowledge.edit'))) AND (m.role='owner' OR pr.knowledge_article_ids IS NULL OR a.id IN (SELECT value FROM json_each(pr.knowledge_article_ids))))`
 const result=await env.DB.batch([
  env.DB.prepare(`SELECT a.* FROM knowledge_articles a WHERE a.id=? AND a.project_id=? AND ${activeProjectSql('a.project_id')} AND ${authority}`).bind(articleId,projectId,principalId),
  env.DB.prepare('SELECT c.* FROM knowledge_categories c WHERE c.project_id=? AND (c.id=(SELECT category_id FROM knowledge_articles WHERE id=? AND project_id=?) OR c.id IN (SELECT category_id FROM knowledge_article_categories WHERE article_id=?)) ORDER BY c.id').bind(projectId,articleId,projectId,articleId)
 ])
 const row=result[0].results[0] as any
 if(!row)return null
 const categories=result[1].results

 return {row,categories}
}
export async function connectedArticleStatus(env:Env,projectId:string,articleId:string,principalId:string){
 const result=await connectedArticleSnapshot(env,projectId,articleId,principalId)
 return result?{status:result.row.status}:null
}
/** The caller supplies current or intended published status; collection
 * visibility decides whether that publication is public before it is written. */
export async function connectedArticlePublic(env:Env,projectId:string,articleId:string){
 return Boolean(await env.DB.prepare(`SELECT 1 FROM knowledge_articles a WHERE a.id=? AND a.project_id=? AND ${visibleCollectionsSql('SELECT a.category_id id WHERE a.category_id IS NOT NULL UNION SELECT category_id FROM knowledge_article_categories WHERE article_id=a.id','a.project_id',anonymousReaders,'a.id')}`).bind(articleId,projectId).first())
}
