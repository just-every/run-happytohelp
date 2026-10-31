import type {Context} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {scope} from '../management/common'

interface ReportSummary {
 completed_at:number|null
 status:string|null
 canonicalised_rows:number
 changed_rows:number
 affected_articles:number
 available_articles:number
}
interface AffectedArticle {id:string;title:string}
const statuses=new Set(['pending','indexing','discovering','failed','completed'])
const pageSize=100

/** Administrative upgrade metadata only. Never select snapshots or article bodies. */
export async function knowledgeUpgradeReport(c:Context<AppEnv>){
 const {projectId}=await scope(c,true),after=c.req.query('after')||''
 if(after.length>2000)throw new HTTPException(400,{message:'Invalid article cursor'})
 const [summary,articles]=await c.env.DB.batch([
  c.env.DB.prepare(`SELECT r.completed_at,json_extract(r.report_json,'$.status') status,
   COALESCE(p.canonicalised_rows,json_extract(r.report_json,'$.canonicalisedRows'),0) canonicalised_rows,
   COALESCE(p.changed_rows,json_extract(r.report_json,'$.changedRows'),0) changed_rows,
   (SELECT count(DISTINCT affected.value) FROM json_each(r.report_json,'$.unpublishedArticles') affected WHERE affected.type='text') affected_articles,
   (SELECT count(DISTINCT a.id) FROM json_each(r.report_json,'$.unpublishedArticles') affected
    JOIN knowledge_articles a ON a.id=affected.value AND a.project_id=r.project_id WHERE affected.type='text') available_articles
   FROM knowledge_upgrade_reports r LEFT JOIN knowledge_upgrade_progress p ON p.project_id=r.project_id
   WHERE r.project_id=?`).bind(projectId),
  c.env.DB.prepare(`SELECT DISTINCT a.id,a.title FROM knowledge_upgrade_reports r,
   json_each(r.report_json,'$.unpublishedArticles') affected
   JOIN knowledge_articles a ON a.id=affected.value AND a.project_id=r.project_id
   WHERE r.project_id=? AND affected.type='text' AND a.id>? ORDER BY a.id LIMIT ?`).bind(projectId,after,pageSize+1),
 ])
 const report=summary.results[0] as unknown as ReportSummary|undefined
 if(!report)throw new HTTPException(404,{message:'Knowledge upgrade report not found'})
 // Restores deliberately clear completion while retaining the report's history.
 const status=report.completed_at!==null?'completed':report.status===null||report.status==='completed'?'pending':report.status
 if(!statuses.has(status))throw new HTTPException(500,{message:'Invalid knowledge upgrade status'})
 const rows=articles.results as unknown as AffectedArticle[],page=rows.slice(0,pageSize)
 c.header('Cache-Control','no-store')
 return c.json({
  status,completedAt:report.completed_at,canonicalisedRows:report.canonicalised_rows,changedRows:report.changed_rows,
  affectedArticleCount:report.affected_articles,unavailableArticleCount:report.affected_articles-report.available_articles,
  unpublishedArticles:page.map(article=>({...article,editorPath:`/projects/${encodeURIComponent(projectId)}/articles/${encodeURIComponent(article.id)}`})),
  nextCursor:rows.length>pageSize?page[page.length-1].id:null,
 })
}
