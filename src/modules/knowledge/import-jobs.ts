import {isProjectActive,requireActiveProject} from '../../platform/project-status'
import {activeProjectSql} from './project-fence'
import {dispatchKnowledgeJob} from './recovery'
import type {Env,Job} from '../../platform/env'
import {hashToken} from '../../platform/auth'
import {htmlToMarkdown,type ImportPlatform} from './importers'
import {checkImportSubdomain,importPageFailure} from './import-requirements'
interface Task {path:string;key?:string;kind:'category'|'section'|'article';parentId?:string}
interface State {platform:ImportPlatform;subdomain?:string;pending:Task[]}
export async function queueImport(env:Env,projectId:string,platform:ImportPlatform,subdomain?:string){
 await requireActiveProject(env,projectId);
 if(!['intercom','freshdesk'].includes(platform))throw new Error('Invalid import platform');checkImportSubdomain(platform,subdomain);
 const id=crypto.randomUUID();const pending:Task[]=platform==='intercom'?[{path:'/help_center/collections',key:'data',kind:'category'},{path:'/help_center/sections',key:'data',kind:'section'},{path:'/articles',key:'data',kind:'article'}]:[{path:'/api/v2/solutions/categories?per_page=100',kind:'category'}];
 await env.FILES.put(`knowledge/imports/${id}/0.json`,JSON.stringify({platform,subdomain,pending}));const admitted=await env.DB.prepare(`INSERT INTO knowledge_imports(id,project_id,platform,status,created_at) SELECT ?,?,?,'queued',? WHERE ${activeProjectSql}`).bind(id,projectId,platform,Date.now(),projectId).run();if(!admitted.meta.changes){await env.FILES.delete(`knowledge/imports/${id}/0.json`);throw new Error('Project is deleted or unavailable')}await dispatchKnowledgeJob(env,{type:'knowledge.import',id,projectId,cursor:0});return {id,status:'queued'}
}
export async function consumeImport(job:Job,env:Env){
 if(!await isProjectActive(env,job.projectId))return true;
 const startedAt=Date.now();const claim=await env.DB.prepare("UPDATE knowledge_imports SET status='processing',processing_started_at=? WHERE id=? AND project_id=? AND cursor=? AND status='queued'").bind(startedAt,job.id,job.projectId,job.cursor).run();if(!claim.meta.changes)return true;
 try{
 const state=await(await env.FILES.get(`knowledge/imports/${job.id}/${job.cursor}.json`))!.json<State>();const {platform}=state;if(!['intercom','freshdesk'].includes(platform))throw new Error('Zendesk articles now import through Settings, Move in, Zendesk, with Connect.');const task=state.pending.shift()!;
 const origin=platform==='intercom'?'https://api.intercom.io':`https://${state.subdomain}.${platform}.com`;
 const secret=(key:string)=>{const value=env[key];if(typeof value!=='string'||!value)throw new Error(`${key} is not set on this installation. Add it, then import again.`);return value};
 const authorization=platform==='intercom'?`Bearer ${secret('INTERCOM_TOKEN')}`:`Basic ${btoa(`${secret('FRESHDESK_TOKEN')}:x`)}`;
 const url=new URL(task.path,origin);if(url.origin!==origin)throw new Error('Provider pagination changed origin');if(!await isProjectActive(env,job.projectId))return true;const response=await fetch(url,{headers:{Authorization:authorization,Accept:'application/json'}});if(!await isProjectActive(env,job.projectId))return true;if(!response.ok)throw new Error(importPageFailure(platform,response.status,origin));const data=await response.json<any>();const rows=task.key?data[task.key]:data;if(!Array.isArray(rows))throw new Error('Invalid provider response');
 const identity=async(kind:string,external:string)=>(await hashToken(`${job.projectId}:${platform}:${kind}:${external}`)).slice(0,32);let categoryCount=0;let articleCount=0;
 for(const item of rows){
 if(!await isProjectActive(env,job.projectId))return true;
 const external=task.kind==='category'?`${platform==='intercom'?'collection':'category'}:${item.id}`:task.kind==='section'?`${platform==='freshdesk'?'folder':'section'}:${item.id}`:String(item.id);
 const id=await identity(task.kind==='article'?'article':'category',external);const title=String(item.title||item.name||'');const slug=`${title.toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,150)||'article'}-${id.slice(-12)}`;
 if(task.kind!=='article'){
 const parentExternal=task.parentId||(task.kind==='section'?`${platform==='intercom'?'collection':'category'}:${item.parent_id||item.category_id}`:undefined);const parent=parentExternal?await identity('category',parentExternal):null;
 await env.DB.prepare(`INSERT INTO knowledge_categories(id,project_id,parent_id,name,slug,summary,is_published) SELECT ?,?,?,?,?,?,? WHERE ${activeProjectSql} ON CONFLICT(id) DO UPDATE SET name=excluded.name,summary=excluded.summary`).bind(id,job.projectId,parent,title,slug,item.description||'',platform==='freshdesk'&&task.kind==='section'?(item.visibility?1:0):1,job.projectId).run();categoryCount++;
 if(platform==='freshdesk')state.pending.push(task.kind==='category'?{path:`/api/v2/solutions/categories/${item.id}/folders?per_page=100`,kind:'section',parentId:external}:{path:`/api/v2/solutions/folders/${item.id}/articles?per_page=100`,kind:'article',parentId:external});
 }else{
 const parentExternal=task.parentId||(platform==='intercom'&&item.parent_id?`${item.parent_type}:${item.parent_id}`:undefined);const category=parentExternal?await identity('category',parentExternal):null;const published=platform==='intercom'?item.state==='published':item.status===2;
 await env.DB.batch([env.DB.prepare(`INSERT INTO knowledge_articles(id,project_id,category_id,slug,title,content,summary,status,updated_at) SELECT ?,?,?,?,?,?,?,?,? WHERE ${activeProjectSql} ON CONFLICT(id) DO UPDATE SET title=excluded.title,content=excluded.content,summary=excluded.summary,status=excluded.status,updated_at=excluded.updated_at`).bind(id,job.projectId,category,slug,title,await htmlToMarkdown(item.body||item.description||''),platform==='intercom'?item.description||'':'',published?'published':'draft',Date.now(),job.projectId),...(category?[env.DB.prepare(`INSERT OR IGNORE INTO knowledge_article_categories(article_id,category_id) SELECT ?,? WHERE ${activeProjectSql} AND EXISTS(SELECT 1 FROM knowledge_articles WHERE id=? AND project_id=? AND category_id=?)`).bind(id,category,job.projectId,id,job.projectId,category)]:[])]);articleCount++;
 }
 }
 const link=response.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/);const p=data.pages;const next=platform==='intercom'?(p?.next?.starting_after?`${url.pathname}?starting_after=${encodeURIComponent(p.next.starting_after)}`:p?.page<p?.total_pages?`${url.pathname}?page=${p.page+1}`:null):data.next_page||link?.[1];
 if(next)state.pending.unshift({...task,path:next});const cursor=Number(job.cursor)+1;await env.FILES.put(`knowledge/imports/${job.id}/${cursor}.json`,JSON.stringify(state));
 if(!await isProjectActive(env,job.projectId))return true;
 const completed=await env.DB.prepare("UPDATE knowledge_imports SET cursor=?,status=?,processing_started_at=NULL,categories=categories+?,articles=articles+? WHERE id=? AND cursor=? AND status='processing' AND processing_started_at=?").bind(cursor,state.pending.length?'queued':'complete',categoryCount,articleCount,job.id,job.cursor,startedAt).run();if(completed.meta.changes&&state.pending.length)await dispatchKnowledgeJob(env,{...job,cursor});return true
 }catch(error){await env.DB.prepare("UPDATE knowledge_imports SET status='failed',error=? WHERE id=? AND cursor=? AND status='processing' AND processing_started_at=?").bind(String(error),job.id,job.cursor,startedAt).run();return true}
}
