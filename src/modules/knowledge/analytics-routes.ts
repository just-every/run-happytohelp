import {preparedArticleSql} from './delivery'
import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {memberAccess} from '../access/gate'
import {requireProject} from '../../platform/auth'
import {accessForKnowledgeConversation} from './access'
import {listAccessibleArticles} from './experience'
import {articleCanonicalUrl} from './public-sources'
import {auditStatement,requestSource} from '../audit/record'
export const analyticsRoutes=new Hono<AppEnv>()
analyticsRoutes.use('/:projectId/*',async(c,next)=>{await requireProject(c,c.req.param('projectId'),true);await next()})
analyticsRoutes.get('/:projectId/analytics',async c=>{
 if(!(await memberAccess(c.env.DB,c.req.param('projectId'),c.get('actor').id))?.permissions.has('reports.view'))throw new HTTPException(403,{message:'Report permission required'})
 const pid=c.req.param('projectId'),locale=c.req.query('locale')||'',brand=c.req.query('brand')||''
 const [events,votes,searches,comments,clicks]=await Promise.all([
 c.env.DB.prepare("SELECT article_id articleId,sum(kind='view') views,sum(kind='click') clicks,sum(kind='ticket') tickets FROM knowledge_events WHERE project_id=? AND (?='' OR locale=?) AND (?='' OR brand=?) GROUP BY article_id").bind(pid,locale,locale,brand,brand).all<any>(),
 c.env.DB.prepare("SELECT article_id articleId,sum(helpful=1) helpful,sum(helpful=0) unhelpful FROM knowledge_feedback WHERE project_id=? AND (?='' OR locale=?) AND (?='' OR brand=?) GROUP BY article_id").bind(pid,locale,locale,brand,brand).all<any>(),
 c.env.DB.prepare("SELECT query,locale,brand,count(*) searches,sum(result_count>0) withResults,sum(coalesce(result_count,0)=0) withoutResults FROM knowledge_events WHERE project_id=? AND kind='search' AND (?='' OR locale=?) AND (?='' OR brand=?) GROUP BY query,locale,brand ORDER BY searches DESC LIMIT 100").bind(pid,locale,locale,brand,brand).all<any>(),
 c.env.DB.prepare("SELECT f.article_id articleId,a.title,f.comment,f.helpful,f.updated_at created_at FROM knowledge_feedback f JOIN knowledge_articles a ON a.id=f.article_id AND a.project_id=f.project_id WHERE f.project_id=? AND f.comment<>'' AND (?='' OR f.locale=?) AND (?='' OR f.brand=?) ORDER BY f.updated_at DESC LIMIT 100").bind(pid,locale,locale,brand,brand).all<any>(),
 c.env.DB.prepare("SELECT query,locale,brand,count(*) clicks FROM knowledge_events WHERE project_id=? AND kind='click' AND query<>'' AND (?='' OR locale=?) AND (?='' OR brand=?) GROUP BY query,locale,brand").bind(pid,locale,locale,brand,brand).all<any>()])
 const rows=await c.env.DB.prepare('SELECT id articleId,title FROM knowledge_articles WHERE project_id=?').bind(pid).all<any>()
 const articles=rows.results.map(a=>({views:0,clicks:0,tickets:0,helpful:0,unhelpful:0,...a,...events.results.find(e=>e.articleId===a.articleId),...votes.results.find(e=>e.articleId===a.articleId)}))
 const totals=articles.reduce((r,a)=>({views:r.views+a.views,clicks:r.clicks+a.clicks,tickets:r.tickets+a.tickets,helpful:r.helpful+a.helpful,unhelpful:r.unhelpful+a.unhelpful}),{views:0,clicks:0,tickets:0,helpful:0,unhelpful:0})
 return c.json({articles,searches:searches.results.map(row=>({...row,clicks:clicks.results.find(click=>click.query===row.query&&click.locale===row.locale&&click.brand===row.brand)?.clicks||0})),comments:comments.results,totals,labels:{tickets:'Tickets from article request links'}})
})
async function conversationAccess(c:any){
 const pid=c.req.param('projectId'),row=await c.env.DB.prepare('SELECT contact_id FROM conversations WHERE id=? AND project_id=?').bind(c.req.param('conversationId'),pid).first()
 if(!row)throw new HTTPException(404,{message:'Conversation not found'})
 return accessForKnowledgeConversation(c.env,pid,c.req.param('conversationId'))
}
analyticsRoutes.get('/:projectId/conversations/:conversationId/articles',async c=>c.json(await listAccessibleArticles(c.env,c.req.param('projectId'),{conversationId:c.req.param('conversationId'),access:await conversationAccess(c),query:(c.req.query('q')||'').slice(0,200),locale:c.req.query('locale')})))
analyticsRoutes.post('/:projectId/conversations/:conversationId/articles/:articleId/insert',async c=>{
 if(!(await memberAccess(c.env.DB,c.req.param('projectId'),c.get('actor').id))?.permissions.has('conversations.reply'))throw new HTTPException(403,{message:'Reply permission required'})
 const pid=c.req.param('projectId'),body=await c.req.json();if(!['text','link'].includes(body.mode))throw new HTTPException(400,{message:'Invalid insertion mode'})
 const articles=await listAccessibleArticles(c.env,pid,{conversationId:c.req.param('conversationId'),access:await conversationAccess(c),locale:body.locale}),article=articles.find(a=>a.id===c.req.param('articleId'))
 if(!article)throw new HTTPException(404,{message:'Article not available to this customer'})
 const url=new URL(articleCanonicalUrl({...c.env,APP_ORIGIN:c.env.APP_ORIGIN||new URL(c.req.url).origin},pid,article.slug));if(article.locale!=='en')url.searchParams.set('locale',article.locale)
 // Persist before returning any composer bytes. This guard rechecks authority
 // in the same statement that records the source; clients cannot omit it later.
 const prepared=await c.env.DB.prepare(`INSERT OR IGNORE INTO knowledge_reply_sources(project_id,conversation_id,source_id,source_version) SELECT c.project_id,c.id,?,? FROM conversations c WHERE c.project_id=? AND c.id=? AND ${preparedArticleSql()} RETURNING source_id`).bind(`article:${article.id}`,article.publication_version,pid,c.req.param('conversationId'),article.id,article.publication_version).all()
 if(!prepared.results.length){
  // An already recorded source is still subject to the live predicate.
  if(!await c.env.DB.prepare(`SELECT 1 FROM conversations c WHERE c.project_id=? AND c.id=? AND EXISTS(SELECT 1 FROM knowledge_reply_sources ks WHERE ks.project_id=c.project_id AND ks.conversation_id=c.id AND ks.source_id='article:'||? AND ks.source_version=?) AND ${preparedArticleSql()}`).bind(pid,c.req.param('conversationId'),article.id,article.publication_version,article.id,article.publication_version).first())throw new HTTPException(409,{message:'Knowledge authority changed; prepare the reply again'})
 }
 await auditStatement(c.env.DB,{projectId:pid,category:'data',action:'knowledge.article.insert_prepared',actor:{type:'user',id:c.get('actor').id},source:requestSource(c),target:{type:'article',id:article.id},detail:{conversationId:c.req.param('conversationId'),mode:body.mode,locale:article.locale}}).run()
 return c.json({text:body.mode==='text'?article.content:`[${article.title.replace(/[\[\]\\]/g,'')}](${url.href})`,url:url.href,title:article.title})
})
