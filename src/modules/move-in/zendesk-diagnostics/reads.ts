import type {PageQuery} from './query'
import type {TicketRow,ArticleRow} from './projection'
export async function summary(db:D1Database,project:string){
 const mappings=await db.prepare(`SELECT COUNT(*) mappingRows,COUNT(DISTINCT source_id) distinctSourceIds,
  (SELECT COUNT(*) FROM (SELECT source_id FROM move_in_conversations WHERE project_id=? AND vendor='zendesk' GROUP BY source_id HAVING COUNT(*)>1)) duplicateSourceGroups
  FROM move_in_conversations WHERE project_id=? AND vendor='zendesk'`).bind(project,project).first<{mappingRows:number;distinctSourceIds:number;duplicateSourceGroups:number}>()
 const origins=await db.prepare(`SELECT COUNT(*) companyOrigins FROM move_in_origins WHERE project_id=? AND vendor='zendesk' AND target_kind='company'`).bind(project).first<{companyOrigins:number}>()
 const articles=await db.prepare(`SELECT COUNT(*) articleOrigins,COUNT(a.id) nativeArticleOrigins,
  COALESCE(SUM(a.status='published'),0) publishedArticleOrigins,COALESCE(SUM(a.status='draft'),0) draftArticleOrigins
  FROM move_in_origins o LEFT JOIN knowledge_articles a ON a.project_id=o.project_id AND a.project_id=? AND a.id=o.target_id
  WHERE o.project_id=? AND o.vendor='zendesk' AND o.target_kind='article'`).bind(project,project).first<{articleOrigins:number;nativeArticleOrigins:number;publishedArticleOrigins:number;draftArticleOrigins:number}>()
 return {...mappings!,...origins!,...articles!}
}
export async function tickets(db:D1Database,project:string,page:PageQuery){
 return (await db.prepare(`SELECT CAST(s.rowid AS TEXT) position,s.source_id,c.id conversation_id,
  (SELECT COUNT(*) FROM messages m WHERE m.project_id=? AND m.project_id=c.project_id AND m.conversation_id=c.id) messages,
  (SELECT COUNT(*) FROM move_in_notes n WHERE n.project_id=? AND n.project_id=c.project_id AND n.conversation_id=c.id) notes,
  EXISTS(SELECT 1 FROM contacts ct WHERE ct.project_id=? AND ct.project_id=c.project_id AND ct.id=c.contact_id) contact_linked
  FROM move_in_conversations s LEFT JOIN conversations c ON c.id=s.conversation_id AND c.project_id=s.project_id AND c.project_id=?
  WHERE s.project_id=? AND s.vendor='zendesk' AND s.rowid>CAST(? AS INTEGER) ORDER BY s.rowid LIMIT ?`).bind(project,project,project,project,project,page.after,page.limit+1).all<TicketRow>()).results
}
export async function articles(db:D1Database,project:string,page:PageQuery){
 return (await db.prepare(`SELECT CAST(o.rowid AS TEXT) position,o.source_id,a.id article_id,a.status
  FROM move_in_origins o LEFT JOIN knowledge_articles a ON a.id=o.target_id AND a.project_id=o.project_id AND a.project_id=?
  WHERE o.project_id=? AND o.vendor='zendesk' AND o.target_kind='article' AND o.rowid>CAST(? AS INTEGER) ORDER BY o.rowid LIMIT ?`).bind(project,project,page.after,page.limit+1).all<ArticleRow>()).results
}
