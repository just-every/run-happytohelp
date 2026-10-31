import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {memberAccess} from '../access/gate'
import {requireProject} from '../../platform/auth'
import {canonicaliseKnowledge} from './canonicaliser'
import {referenceVisibility} from './reference-store'
import {currentTicketReaders} from './readers'
import {memberReaders} from './door'
import {pickerArticles,insertArticleReference} from './insertion'
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
function envelope(c:any,body:any={}){let cc=body.cc,bcc=body.bcc;try{cc=cc??JSON.parse(c.req.query('cc')||'[]');bcc=bcc??JSON.parse(c.req.query('bcc')||'[]')}catch{throw new HTTPException(400,{message:'Invalid recipients'})}if(!Array.isArray(cc)||!Array.isArray(bcc)||[...cc,...bcc].some(address=>typeof address!=='string'))throw new HTTPException(400,{message:'Invalid recipients'});return [...cc,...bcc]}
async function conversationAudience(c:any,body:any={}){
 const pid=c.req.param('projectId'),cid=c.req.param('conversationId');if(!await c.env.DB.prepare('SELECT 1 FROM conversations WHERE project_id=? AND id=?').bind(pid,cid).first())throw new HTTPException(404,{message:'Not found'})
 return currentTicketReaders(pid,cid,{addresses:envelope(c,body)})
}
analyticsRoutes.get('/:projectId/conversations/:conversationId/articles',async c=>{
 const articles=await pickerArticles(c.env,c.req.param('projectId'),c.get('actor').id,await conversationAudience(c),(c.req.query('q')||'').slice(0,200),c.req.query('locale'))
 return c.json(c.req.query('view')==='editor'?articles:articles.filter(article=>article.insertable))
})
analyticsRoutes.post('/:projectId/conversations/:conversationId/articles/:articleId/insert',async c=>{
 const body=await c.req.json();if(!['text','link'].includes(body.mode))throw new HTTPException(400,{message:'Invalid insertion mode'})
 return c.json(await insertArticleReference({...c.env,APP_ORIGIN:c.env.APP_ORIGIN||new URL(c.req.url).origin},c.req.param('projectId'),c.req.param('articleId'),c.get('actor').id,await conversationAudience(c,body),body.mode,body.locale))
})
analyticsRoutes.post('/:projectId/references/insert',async c=>{
 const body=await c.req.json();if(typeof body.articleId!=='string'||!['text','link'].includes(body.mode))throw new HTTPException(400,{message:'Invalid insertion'})
 return c.json(await insertArticleReference({...c.env,APP_ORIGIN:c.env.APP_ORIGIN||new URL(c.req.url).origin},c.req.param('projectId'),body.articleId,c.get('actor').id,memberReaders(c.get('actor').id),body.mode,body.locale))
})

analyticsRoutes.post('/:projectId/references/preview',async c=>{
 const body=await c.req.json(),pid=c.req.param('projectId'),actor=c.get('actor')
 if(typeof body.content!=='string'||body.content.length>100000||body.conversationId!==undefined&&typeof body.conversationId!=='string')throw new HTTPException(400,{message:'Invalid reference preview'})
 let readers=memberReaders(actor.id)
 if(body.conversationId){if(!await c.env.DB.prepare('SELECT 1 FROM conversations WHERE project_id=? AND id=?').bind(pid,body.conversationId).first())throw new HTTPException(404,{message:'Not found'});readers=currentTicketReaders(pid,body.conversationId,{addresses:envelope(c,body)})}
 const content=await canonicaliseKnowledge(c.env,pid,body.content)
 return c.json({content,references:await referenceVisibility(c.env,pid,content,actor.id,readers)})
})
