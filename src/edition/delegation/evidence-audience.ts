import type {Env} from '../../platform/env'
import {memberAccess} from '../../modules/access/gate'
import {articleAccessSql} from '../../modules/knowledge/access'

/** A published article can still be private. Resolve the audience from current
 * collection ancestry and each member's effective selection on every request. */
export async function evidenceAudience(env:Env,projectId:string,kind:string,id:string,status?:string){
 const members=await env.DB.prepare('SELECT user_id FROM memberships WHERE project_id=? ORDER BY user_id').bind(projectId).all<{user_id:string}>()
 const scoped=await Promise.all(members.results.map(async member=>({id:member.user_id,access:await memberAccess(env.DB,projectId,member.user_id)})))
 const principalIds=scoped.filter(({access})=>access&&(kind==='articles'?(access.permissions.has('knowledge.read')||access.permissions.has('knowledge.edit'))&&(access.knowledgeArticleIds===null||access.knowledgeArticleIds.includes(id)):true)).map(member=>member.id)
 const publicArticle=kind==='articles'&&status==='published'&&Boolean(await env.DB.prepare(`SELECT 1 FROM knowledge_articles a WHERE a.id=? AND a.project_id=? AND ${articleAccessSql('a')}`).bind(id,projectId).first())
 return {body:publicArticle?{kind:'public' as const}:{kind:'source-principals' as const,principalIds},principalIds}
}
