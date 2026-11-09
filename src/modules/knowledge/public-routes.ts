import {Hono} from 'hono'
import type {AppEnv} from '../../platform/env'
import {requiredString} from '../../platform/db'
import {resolveHelpAccess} from './access'
import {listAccessibleArticles,listAccessibleCategories,lookupAccessibleArticle,getKnowledgeExperience} from './experience'
import {knowledgeRateLimit,knowledgeVisitorHash,recordKnowledgeEvent,recordReadEvent,recordHelpfulVote} from './feedback'
import {oncePerRequest} from '../../platform/read-effects'
import {safeHelpReturn,helpSameOrigin} from './help-auth'
export const publicKnowledgeRoutes=new Hono<AppEnv>()
publicKnowledgeRoutes.use('/public/:projectId/*',async(c,next)=>{c.header('Cache-Control','private, no-store');c.header('Vary','Cookie, Authorization');await next()})
publicKnowledgeRoutes.get('/public/:projectId/experience',async c=>c.json(await getKnowledgeExperience(c.env,c.req.param('projectId'))))
publicKnowledgeRoutes.get('/public/:projectId/articles',async c=>c.json(await listAccessibleArticles(c.env,c.req.param('projectId'),{access:await resolveHelpAccess(c.env,c.req.param('projectId'),c.req.raw),locale:c.req.query('locale')})))
publicKnowledgeRoutes.get('/public/:projectId/categories',async c=>c.json(await listAccessibleCategories(c.env,c.req.param('projectId'),await resolveHelpAccess(c.env,c.req.param('projectId'),c.req.raw),c.req.query('locale'))))
publicKnowledgeRoutes.get('/public/:projectId/articles/:slug',async c=>{
 const found=await lookupAccessibleArticle(c.env,c.req.param('projectId'),c.req.param('slug'),{access:await resolveHelpAccess(c.env,c.req.param('projectId'),c.req.raw),locale:c.req.query('locale')})
 return found?c.json({...found.article,...(found.redirectSlug?{redirectSlug:found.redirectSlug}:{})}):c.json({error:'Not found'},404)
})
publicKnowledgeRoutes.get('/public/:projectId/search',async c=>{
 const pid=c.req.param('projectId'),query=requiredString(c.req.query('q'),'query',200),access=await resolveHelpAccess(c.env,pid,c.req.raw),locale=c.req.query('locale'),articles=await listAccessibleArticles(c.env,pid,{access,locale,query})
 // One search counts once against the visitor's budget and records one event, however often it is dispatched (platform/read-effects.ts).
 await oncePerRequest(c.req.raw,'knowledge-search-limit',()=>knowledgeRateLimit(c.env,`search:${pid}:${c.req.header('CF-Connecting-IP')||'unknown'}`,300))
 await recordReadEvent(c,pid,{kind:'search',query,resultCount:articles.length,access,locale,visitorHash:await knowledgeVisitorHash(pid,c.req.raw,access)})
 return c.json(articles)
})
publicKnowledgeRoutes.post('/public/:projectId/articles/:slug/helpful',async c=>{
 helpSameOrigin(c.req.raw)
 const isForm=!(c.req.header('Content-Type')||'').includes('application/json'),body:any=isForm?await c.req.parseBody():await c.req.json(),pid=c.req.param('projectId'),access=await resolveHelpAccess(c.env,pid,c.req.raw),visitorHash=await knowledgeVisitorHash(pid,c.req.raw,access),locale=body.locale||c.req.query('locale')
 await knowledgeRateLimit(c.env,`feedback:${pid}:${visitorHash}`,30)
 if(![true,false,'true','false','1','0','yes','no'].includes(body.helpful))return c.json({error:'Choose helpful or unhelpful'},400)
 const result=await recordHelpfulVote(c.env,pid,c.req.param('slug'),{helpful:body.helpful===true||body.helpful==='true'||body.helpful==='1'||body.helpful==='yes',comment:body.comment,locale,access,visitorHash})
 if(isForm){const url=new URL(safeHelpReturn(body.returnTo,c.req.url,`/help/${encodeURIComponent(pid)}/${encodeURIComponent(c.req.param('slug'))}`),c.req.url);url.searchParams.set('feedback','1');if(locale)url.searchParams.set('locale',locale);return c.redirect(url.pathname+url.search,303)}
 return c.json(result)
})
publicKnowledgeRoutes.post('/public/:projectId/events',async c=>{
 helpSameOrigin(c.req.raw)
 const body=await c.req.json();if(!['view','search','click'].includes(body.kind))return c.json({error:'Invalid public event'},400)
 const pid=c.req.param('projectId'),access=await resolveHelpAccess(c.env,pid,c.req.raw),visitorHash=await knowledgeVisitorHash(pid,c.req.raw,access)
 await knowledgeRateLimit(c.env,`event:${pid}:${visitorHash}`,300)
 if(body.kind==='search'){const articles=await listAccessibleArticles(c.env,pid,{access,locale:body.locale,query:String(body.query||'').slice(0,200)});body.resultCount=articles.length}
 return c.json(await recordKnowledgeEvent(c.env,pid,{kind:body.kind,slug:body.slug,query:body.query,resultCount:body.resultCount,locale:body.locale,access,visitorHash}))
})
