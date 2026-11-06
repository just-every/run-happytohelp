import {getKnowledgeExperience,validLocale} from './experience'
import {visibleArticleSql,type Readers} from './door'
import {isProjectActive,requireActiveProject} from '../../platform/project-status'
import {cronRoom} from '../../platform/cron-budget'
import {dispatchKnowledgeJob,recoverKnowledgeJobs} from './recovery'
import {consumeImport} from './import-jobs'
import {startCrawl,crawlStatus,websiteReader,type CrawlConfig} from './crawl'
import {readWebsite} from './website-reader'
import {stageCorpus,consumePage} from './ingestion'
import type { Env, Job } from '../../platform/env'
import { apifyDocuments, collection, embeddings, qdrant, type DocumentInput } from './providers'
import {articleCanonicalUrl,readKnowledgeSource} from './public-sources'
export interface Citation { id:string;sourceVersion:string;url:string;title:string;content:string;score:number;locale?:string;requestedLocale?:string;localeFallback?:boolean }
export function validateDocuments(value:unknown):DocumentInput[]{
 if(!Array.isArray(value)||value.length===0)throw new Error('Expected nonempty documents');
 return value.map(d=>{if(!d||typeof d.url!=='string'||typeof d.title!=='string'||typeof d.content!=='string'||!d.content.trim())throw new Error('Invalid document');const url=new URL(d.url);if(!['https:','http:','h2h:'].includes(url.protocol))throw new Error('Invalid source URL');return {url:url.href,title:d.title.slice(0,500),content:d.content}})
}
export async function refreshDataset(env:Env,projectId:string,datasetId:string,input:{documents?:unknown;apifyDatasetId?:string;semantic?:boolean;crawl?:CrawlConfig;messages?:Array<{role:string;content:string}>}){
 await requireActiveProject(env,projectId);
 const token=crypto.randomUUID();const job:Job={...input,type:'knowledge.ingest',id:token,projectId,datasetId};
 // Retain both inputs before the D1 stage becomes eligible for scheduled dispatch.
 await env.FILES.put(`knowledge/sources/${token}.json`,JSON.stringify(input));await env.FILES.put(`knowledge/jobs/${token}.json`,JSON.stringify(job));
 const claim=await env.DB.prepare("UPDATE knowledge_datasets SET claim_token=?,source_input=?,status='ingesting',ingest_cursor=-1,ingest_started_at=NULL,error=NULL WHERE id=? AND project_id=? AND claim_token IS NULL AND EXISTS(SELECT 1 FROM projects p WHERE p.id=knowledge_datasets.project_id AND NOT EXISTS(SELECT 1 FROM project_settings s WHERE s.project_id=p.id AND json_extract(s.settings_json,'$.deleted_at') IS NOT NULL))").bind(token,JSON.stringify({retainedJobId:token}),datasetId,projectId).run();
 if(!claim.meta.changes){await env.FILES.delete([`knowledge/sources/${token}.json`,`knowledge/jobs/${token}.json`]);throw new Error('Dataset missing or refresh already active')}
 await dispatchKnowledgeJob(env,{type:job.type,id:token,projectId,datasetId});return {id:token,status:'queued'}
}
/** Start from saved website settings for both creation and explicit refresh. */
export async function crawlDataset(env:Env,projectId:string,datasetId:string,semantic=false){
 const dataset=await env.DB.prepare('SELECT * FROM knowledge_datasets WHERE id=? AND project_id=?').bind(datasetId,projectId).first<any>();
 if(!dataset)throw new Error('Dataset not found');
 return refreshDataset(env,projectId,datasetId,{crawl:{url:dataset.url,excluded_urls:JSON.parse(dataset.excluded_urls),max_crawl_depth:dataset.max_crawl_depth,max_crawl_pages:dataset.max_crawl_pages},semantic})
}
async function fail(env:Env,datasetId:string,token:string,error:unknown){await env.DB.prepare("UPDATE knowledge_datasets SET status='failed',error=?,claim_token=NULL,next_refresh_at=NULL WHERE id=? AND claim_token=?").bind((error instanceof Error?error.message:String(error)).slice(0,1000),datasetId,token).run()}
export async function consumeJob(job:Job,env:Env):Promise<boolean>{
 if(job.type.startsWith('knowledge.')&&!await isProjectActive(env,job.projectId))return true;
 if(job.type==='knowledge.import')return consumeImport(job,env);
 if(job.type==='knowledge.crawl-poll'){
 const active=await env.DB.prepare('SELECT id FROM knowledge_datasets WHERE id=? AND project_id=? AND claim_token=? AND status=\'crawling\'').bind(job.datasetId,job.projectId,job.id).first();if(!active)return true;
 try{if(!await isProjectActive(env,job.projectId))return true;const status=await crawlStatus(env,String(job.runId));if(!await isProjectActive(env,job.projectId))return true;if(['FAILED','ABORTED','TIMED-OUT'].includes(status.status))throw new Error(`Crawl ${status.status}`);
 if(status.status!=='SUCCEEDED'){await dispatchKnowledgeJob(env,job,60);return true}
 const claimed=await env.DB.prepare("UPDATE knowledge_datasets SET status='processing',ingest_started_at=? WHERE id=? AND claim_token=? AND status='crawling'").bind(Date.now(),job.datasetId,job.id).run();if(!claimed.meta.changes)return true;
 const file=await env.FILES.get(`knowledge/jobs/${job.id}.json`);const input=await file!.json<any>();input.apifyDatasetId=status.defaultDatasetId;delete input.crawl;await env.FILES.put(`knowledge/jobs/${job.id}.json`,JSON.stringify(input));await env.DB.prepare("UPDATE knowledge_datasets SET status='ingesting' WHERE id=? AND claim_token=?").bind(job.datasetId,job.id).run();await dispatchKnowledgeJob(env,{...job,type:'knowledge.ingest'});return true
 }catch(error){await fail(env,String(job.datasetId),job.id,error);return true}
 }
 if(job.type==='knowledge.page')return consumePage(job,env);
 if(job.type!=='knowledge.ingest')return false;
 const dataset=await env.DB.prepare('SELECT * FROM knowledge_datasets WHERE id=? AND project_id=? AND claim_token=?').bind(job.datasetId,job.projectId,job.id).first<any>();if(!dataset)return true;
 // Persist attempt before any provider call. Redelivery cannot replay ambiguous paid ingestion.
 const admitted=await env.DB.prepare("UPDATE knowledge_datasets SET status='processing',ingest_started_at=? WHERE id=? AND claim_token=? AND status='ingesting' AND ingest_cursor=-1").bind(Date.now(),job.datasetId,job.id).run();if(!admitted.meta.changes)return true;
 try{
 const file=await env.FILES.get(`knowledge/jobs/${job.id}.json`);if(!file)throw new Error('Ingestion input missing');const input=await file.json<any>();
 if(!await isProjectActive(env,job.projectId))return true;
 if(input.crawl&&websiteReader(env).reader==='built-in'){const docs=await readWebsite(input.crawl);if(!await isProjectActive(env,job.projectId))return true;await stageCorpus(env,job,validateDocuments(docs),!!input.semantic);return true}
 if(input.crawl){const run=await startCrawl(env,input.crawl);if(!await isProjectActive(env,job.projectId))return true;await env.FILES.put(`knowledge/crawl/${job.id}.json`,JSON.stringify(run));await env.DB.prepare("UPDATE knowledge_datasets SET status='crawling' WHERE id=? AND claim_token=?").bind(job.datasetId,job.id).run();await dispatchKnowledgeJob(env,{...job,type:'knowledge.crawl-poll',runId:run.runId},60);return true}
 const messageDocs=input.messages?[{url:`h2h://conversation/${encodeURIComponent(String(job.datasetId))}`,title:'Conversation history',content:input.messages.map((m:any)=>`${String(m.role).toUpperCase()}: ${m.content}`).join('\n\n')}]:undefined;
 if(!await isProjectActive(env,job.projectId))return true;
 const docs=validateDocuments(input.documents??messageDocs??await apifyDocuments(env,input.apifyDatasetId));await stageCorpus(env,job,docs,!!input.semantic);return true
 }catch(error){await fail(env,String(job.datasetId),job.id,error);return true}
}
export async function searchKnowledge(env:Env,projectId:string,query:string,readers:Readers,mode:'lexical'|'semantic'='lexical',requestedLocale?:string):Promise<Citation[]>{
 await requireActiveProject(env,projectId);
 const versions=await env.DB.prepare('SELECT v.id,v.semantic,v.embedding_model FROM knowledge_datasets d JOIN knowledge_versions v ON v.id=d.published_version WHERE d.project_id=?').bind(projectId).all<{id:string;semantic:number;embedding_model:string}>();
 const rows=await env.DB.prepare('SELECT f.id,f.version_id sourceVersion,f.url,f.title,f.content FROM knowledge_documents f JOIN knowledge_datasets d ON d.published_version=f.version_id WHERE d.project_id=?').bind(projectId).all<Citation>();
 const articles=await env.DB.prepare(`SELECT id,publication_version sourceVersion,slug,title,content FROM knowledge_articles a WHERE project_id=? AND ${visibleArticleSql('a',readers)}`).bind(projectId).all<any>();
 const native:Citation[]=[],settings=requestedLocale?await getKnowledgeExperience(env,projectId):null
 if(requestedLocale&&!settings!.locales.includes(validLocale(requestedLocale)))throw new Error('Choose a configured knowledge locale')
 for(const article of articles.results){
  const translated=requestedLocale&&requestedLocale!==settings!.defaultLocale?await env.DB.prepare('SELECT publication_version FROM knowledge_translations WHERE article_id=? AND locale=? AND published_source_version=? AND published_json IS NOT NULL').bind(article.id,requestedLocale,article.sourceVersion).first<any>():null
  const ref={id:`article:${article.id}`,sourceVersion:requestedLocale?`${article.sourceVersion}~${requestedLocale}~${translated?.publication_version||'base'}~${settings!.defaultLocale}`:article.sourceVersion}
  const row=await readKnowledgeSource(env,projectId,ref,readers)
  if(row)native.push({...row,...ref,score:0})
 }

 const tokens=[...new Set(query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(t=>t.length>=3))].slice(0,24);
 const rank=(docs:Citation[])=>docs.map(d=>({...d,score:tokens.reduce((n,t)=>n+(d.title.toLowerCase().includes(t)?6:0)+(d.content.toLowerCase().includes(t)?1:0),0)})).filter(d=>d.score>0).sort((a,b)=>b.score-a.score);
 const current=async(docs:Citation[])=>{const result:Citation[]=[];for(const d of docs){const row=await readKnowledgeSource(env,projectId,d,readers);if(row)result.push({...d,...row,content:snippet(row.content,tokens,2800)})}return result};
 if(mode==='semantic'){
 if(!versions.results.length)return current(rank(native).slice(0,3));
 if(versions.results.some(v=>!v.semantic))throw new Error('SEMANTIC_INDEX_UNAVAILABLE: publish all selected datasets with semantic indexing');
 const vectors=new Map<string,number[]>();const hits:any[]=[];
 for(const v of versions.results){await requireActiveProject(env,projectId);if(!vectors.has(v.embedding_model)){const [vector]=await embeddings({...env,KNOWLEDGE_EMBEDDING_MODEL:v.embedding_model},[query]);vectors.set(v.embedding_model,vector)}const vector=vectors.get(v.embedding_model)!;await requireActiveProject(env,projectId);const data=await qdrant(env,`/collections/${collection(v.id)}/points/search`,'POST',{vector,limit:20,with_payload:true,with_vector:true});hits.push(...maximalMarginalRelevance(vector,data.result,1))}
 return current([...rank(native).slice(0,3),...hits.sort((a,b)=>b.score-a.score).flatMap(h=>{const row=rows.results.find(r=>r.id===h.payload.documentId);return row?[{...row,id:`knowledge:${row.id}`,content:h.payload.content,score:h.score}]:[]})])
 }
 return current(rank([...native,...rows.results.map(d=>({...d,id:`knowledge:${d.id}`}))]).slice(0,3))
}

export async function refreshDueDatasets(env:Env){
 await recoverKnowledgeJobs(env)
 if(!cronRoom(env,1))return 0
 const due=await env.DB.prepare("SELECT id,project_id,source_input FROM knowledge_datasets WHERE next_refresh_at<=? AND claim_token IS NULL AND source_input IS NOT NULL AND EXISTS(SELECT 1 FROM projects p WHERE p.id=knowledge_datasets.project_id AND NOT EXISTS(SELECT 1 FROM project_settings s WHERE s.project_id=p.id AND json_extract(s.settings_json,'$.deleted_at') IS NOT NULL)) LIMIT 25").bind(Date.now()).all<{id:string;project_id:string;source_input:string}>();
 let refreshed=0
 for(const row of due.results){
  // Admission includes both authority checks and a failed queue-send receipt.
  if(!cronRoom(env,5))break
  if(!await isProjectActive(env,row.project_id))continue
  const source=JSON.parse(row.source_input)
  const input=source.retainedJobId?await(await env.FILES.get(`knowledge/sources/${source.retainedJobId}.json`))!.json<any>():source
  await refreshDataset(env,row.project_id,row.id,input)
  refreshed++
 }
 return refreshed
}

// Python's Qdrant MMR retriever selects k=1 independently per collection.
export function maximalMarginalRelevance(query:number[],candidates:any[],k=1,lambda=0.5){
 const cosine=(a:number[],b:number[])=>{const dot=a.reduce((n,x,i)=>n+x*b[i],0);return dot/(Math.sqrt(a.reduce((n,x)=>n+x*x,0))*Math.sqrt(b.reduce((n,x)=>n+x*x,0))||1)};
 const selected:any[]=[];const remaining=[...candidates];
 while(selected.length<k&&remaining.length){let best=0;let score=-Infinity;remaining.forEach((item,i)=>{const value=selected.length?lambda*cosine(query,item.vector)-(1-lambda)*Math.max(...selected.map(s=>cosine(item.vector,s.vector))):cosine(query,item.vector);if(value>score){score=value;best=i}});selected.push(remaining.splice(best,1)[0])}return selected
}

export function snippet(content:string,tokens:string[],max:number){if(content.length<=max)return content;const positions=tokens.map(t=>content.toLowerCase().indexOf(t)).filter(i=>i>=0);const first=positions.length?Math.min(...positions):0;const start=Math.max(0,first-Math.floor(max/2));return `${start?'…':''}${content.slice(start,start+max).trim()}${start+max<content.length?'…':''}`}
