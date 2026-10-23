import { Hono } from 'hono'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AppEnv,Env } from '../../platform/env'
import { requireProject } from '../../platform/auth'
import { escapeHtml as e } from './html'
import { categoryTree } from './category-tree'
import { missingArticlePage,missingHelpCenterPage } from './not-found'
import { shell } from './shell'
import {hasRestrictedCollections,resolveHelpAccess} from '../knowledge/access'
import {getKnowledgeExperience,selectKnowledgeLocale,listAccessibleCategories,listAccessibleArticles,lookupAccessibleArticle} from '../knowledge/experience'
import {knowledgeVisitorHash,recordKnowledgeEvent} from '../knowledge/feedback'
import {helpControls,signInContent,helpfulContent,localeQuery} from './help-controls'
import {helpTemplate} from './help-template'
import {publicAppearance} from '../widget/appearance.js'
const articleComponents: React.ComponentProps<typeof Markdown>['components'] = {
 pre: ({children}) => <pre tabIndex={0} role="region" aria-label="Code block">{children}</pre>,
 table: ({children}) => <div className="help-center-table-scroll" tabIndex={0} role="region" aria-label="Article table"><table>{children}</table></div>,
}
export const reserved=new Set(['api','health','setup','login','logout','projects','conversations','contacts','settings','dashboard','marketing','features','resources','company','pricing','waitlist','demo','help','portal','docs','run','site-assets','widget.js'])
export async function resolvePublicProject(env:Env,key:string,includeDeleted=false){const project=await env.DB.prepare('SELECT p.id,p.name,(SELECT settings_json FROM project_settings s WHERE s.project_id=p.id) settings_json FROM projects p LEFT JOIN public_project_aliases a ON a.project_id=p.id WHERE (p.id=? OR a.slug=?) AND (?=1 OR NOT EXISTS(SELECT 1 FROM project_settings s WHERE s.project_id=p.id AND json_extract(s.settings_json,\'$.deleted_at\') IS NOT NULL)) LIMIT 1').bind(key,key,includeDeleted?1:0).first<{id:string,name:string,settings_json:string}>();if(!project)return null;return {id:project.id,name:project.name,brand:publicAppearance(JSON.parse(project.settings_json||'{}'),project.name)}}
export const helpCenterRoutes=new Hono<AppEnv>()
helpCenterRoutes.put('/api/public-site/projects/:projectId/alias',async c=>{const actor=await requireProject(c,c.req.param('projectId'),true);if(!['owner','admin'].includes(actor.role))return c.json({error:'Project administration required'},403);const b=await c.req.json(),slug=String(b.slug||'').toLowerCase();if(!/^[a-z0-9][a-z0-9-]{1,99}$/.test(slug)||reserved.has(slug))return c.json({error:'Invalid or reserved public slug'},422);if(await c.env.DB.prepare('SELECT id FROM projects WHERE id=? AND id<>?').bind(slug,c.req.param('projectId')).first())return c.json({error:'Slug already in use'},409);const result=await c.env.DB.prepare('INSERT INTO public_project_aliases(slug,project_id) VALUES(?,?) ON CONFLICT(slug) DO UPDATE SET project_id=excluded.project_id WHERE public_project_aliases.project_id=excluded.project_id').bind(slug,c.req.param('projectId')).run();return result.meta.changes?c.json({slug}):c.json({error:'Slug already in use'},409)})
export async function renderHelpCenter(c:any,key:string,base:string,tail?:string){
 const project=await resolvePublicProject(c.env,key)
 if(!project)return c.html(missingHelpCenterPage(),404)
 // Personalized help and feedback never enter shared caches.
 c.header('Cache-Control','private, no-store');c.header('Vary','Cookie, Authorization');c.header('Referrer-Policy','same-origin')
 const access=await resolveHelpAccess(c.env,project.id,c.req.raw)
 const settings=await getKnowledgeExperience(c.env,project.id)
 const locale=await selectKnowledgeLocale(c.env,project.id,c.req.query('locale'))
 const suffix=localeQuery(locale,settings.defaultLocale)
 const keyword=String(c.req.query('keyword')||c.req.query('q')||'').trim().slice(0,200)
 const visitorHash=await knowledgeVisitorHash(project.id,c.req.raw,access)
 const restrictedCollections=await hasRestrictedCollections(c.env,project.id)
 let tools=helpControls(base,tail,locale,{...settings,projectId:project.id,restrictedCollections},access,keyword)
 let content=''
 if(c.req.query('access')==='signin')content=signInContent(project.id,base,c.req.query('sent')==='1')
 else if(tail==='search'){
  if(!keyword)content=`<p>What information would you like to find in the ${e(project.name)} Help Center?</p><p>Please enter your search query above.</p>`
  else{
   const page=Math.max(1,Math.min(100000,Number.parseInt(c.req.query('page')||'1',10)||1))
   const matches=await listAccessibleArticles(c.env,project.id,{access,locale,query:keyword})
   const rows=matches.slice((page-1)*15,page*15)
   await recordKnowledgeEvent(c.env,project.id,{kind:'search',locale,query:keyword,resultCount:matches.length,visitorHash,access})
   content=`<h1>Search results</h1><p>${matches.length} results found</p>`+(matches.length===0?`<p class="help-center-notice">Try a shorter phrase or different words, or <a href="${base || '/'}${suffix}">browse all articles</a>.</p>`:'')+rows.map((a:any)=>`<h4><a href="${base}/${encodeURIComponent(a.slug)}${suffix}">${e(a.title)}</a></h4><p>${e(a.summary)}</p>`).join('')
   const query=`keyword=${encodeURIComponent(keyword)}${locale===settings.defaultLocale?'':`&amp;locale=${encodeURIComponent(locale)}`}`
   content+=`<nav aria-label="Search pages">${page>1?`<a href="${base}/search?${query}&amp;page=${page-1}">Previous</a>`:''} ${matches.length>page*15?`<a href="${base}/search?${query}&amp;page=${page+1}">Next</a>`:''}</nav>`
  }
  content=helpTemplate(settings.templates.search,content,'Search results',keyword)
 }else if(tail){
  const found=await lookupAccessibleArticle(c.env,project.id,tail,{access,locale})
  if(!found)return c.html(missingArticlePage(project,base),404)
  if(found.redirectSlug)return c.redirect(`${base}/${encodeURIComponent(found.redirectSlug)}${suffix}`,308)
  const article=found.article
  const view=await recordKnowledgeEvent(c.env,project.id,{kind:'view',slug:article.slug,locale,visitorHash,access})
  tools=tools.replace('/requests\"',`/requests?afterReading=${encodeURIComponent(view.eventId)}&amp;locale=${encodeURIComponent(locale)}\"`)
  content=(article.locale!==locale?`<p class="help-center-translation-note">This article is available in ${e(article.locale)} while its translation is being reviewed.</p>`:'')+`<article lang="${e(article.locale)}"><h1>${e(article.title)}</h1>`+renderToStaticMarkup(<Markdown remarkPlugins={[remarkGfm]} components={articleComponents}>{String(article.content)}</Markdown>)+'</article>'
  content=helpTemplate(settings.templates.article,content,article.title,article.summary)
  content+=helpfulContent(project.id,article.slug,article.locale,`${base}/${encodeURIComponent(article.slug)}${suffix}`,c.req.query('feedback')==='1')
 }else{
  const [categories,articles]=await Promise.all([listAccessibleCategories(c.env,project.id,access,locale),listAccessibleArticles(c.env,project.id,{access,locale})])
  content=categoryTree(categories,articles,base,suffix,settings.templates)||'<h1>How can we help?</h1><p class="help-center-notice">There are no published articles yet. Please contact the support team through the website chat.</p>'
  content=helpTemplate(settings.templates.home,content,project.name)
 }
 return c.html(shell(project,base,content,{keyword,greeting:!tail,locale,defaultLocale:settings.defaultLocale,tools}))
}
function render(c:any){const key=c.req.param('project'),base=c.req.path.startsWith('/help/')?`/help/${encodeURIComponent(key)}`:`/${encodeURIComponent(key)}`;return renderHelpCenter(c,key,base,c.req.param('article'))}
helpCenterRoutes.get('/help/:project',render)
helpCenterRoutes.get('/help/:project/',render)
helpCenterRoutes.get('/help/:project/:article',render)
helpCenterRoutes.get('/:project',render)
helpCenterRoutes.get('/:project/',render)
helpCenterRoutes.get('/:project/:article',render)
