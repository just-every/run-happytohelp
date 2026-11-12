import { type Row,type LegacyBundle,type MappedRow,timestamp,text,stable } from './types'
import {truth,columns,publishedFiles} from './mapping-shared'
import {relationships} from './relationships'

function crawlLimit(value:unknown,field:string){
 if(value===undefined||value===null||typeof value==='string'&&value.trim()==='')return undefined
 const parsed=typeof value==='number'?value:typeof value==='string'?Number(value):NaN
 if(!Number.isSafeInteger(parsed)||parsed<0)throw new Error(`Invalid legacy crawl limit: ${field}`)
 return parsed
}
function excludedUrls(value:unknown,legacy:boolean){
 if(value===undefined||value===null||value==='')return undefined
 const urls=typeof value==='string'?(legacy?value.split(/\r?\n/).map(url=>url.trim()).filter(Boolean):JSON.parse(value)):value
 if(!Array.isArray(urls)||urls.some(url=>typeof url!=='string'))throw new Error('Invalid legacy dataset excluded_urls')
 return stable(urls)
}
function crawlSettings(r:Row,legacy:boolean){
 const excluded=excludedUrls(r.excluded_urls,legacy),depth=crawlLimit(r.max_crawl_depth,'max_crawl_depth'),pages=crawlLimit(r.max_crawl_pages,'max_crawl_pages')
 // Legacy datasets with a URL came from the crawler. Preserve its input so a
 // published import remains editable/refreshable through the native interface.
 const input=r.source_input??(legacy&&r.url?stable({crawl:{url:r.url,excluded_urls:excluded?JSON.parse(excluded):[],max_crawl_depth:depth,max_crawl_pages:pages}}):null)
 return {source_input:input,excluded_urls:excluded,max_crawl_depth:depth,max_crawl_pages:pages}
}
function refreshSettings(r:Row){
 const mode=r.refresh_mode??'manual'
 const supported=['manual','daily','weekly','monthly','adaptive'].includes(String(mode))
 const unchanged=Number(r.refresh_unchanged_count??r.unchanged_count??0)
 if(!Number.isSafeInteger(unchanged)||unchanged<0)throw new Error('Invalid legacy dataset refresh unchanged count')
 // Keep supported preferences and publication evidence, without carrying a
 // running claim or scheduling a new paid crawl in the destination.
 return {row:{refresh_mode:supported?mode:'manual',unchanged_count:unchanged,last_refreshed_at:r.last_refreshed_at?timestamp(r.last_refreshed_at):null,next_refresh_at:null,claim_token:null},hold:!supported?'Imported refresh schedule has no native equivalent; refresh manually':r.next_refresh_at||r.refresh_claimed_at||r.refresh_claim_token?'Imported refresh schedule held; refresh explicitly before scheduling again':undefined}
}
export function mapKnowledge(table:string,r:Row,b:LegacyBundle):MappedRow[]|undefined {
 const created=timestamp(r.created_at),project=r.project_id&&String(r.project_id),id=r.id&&String(r.id);const one=(table:string,row:Row,key=['id'],hold?:string):MappedRow[]=>[{table,row,key,hold}]
 switch(table){
 case 'ais':case 'ai_profiles':{const defaults=(b.tables.ai_defaults||[]).find(d=>d.type===r.type);return one('ai_profiles',{id,project_id:project,name:text(r.name,'ais.name'),role:r.role||defaults?.role||r.type||'assistant',prompt:r.prompt||r.instructions||defaults?.prompt||'',model:text(r.model||b.source.aiModel,'ais.model or source.aiModel explicit selected model'),is_enabled:r.is_enabled===false||r.is_enabled===0?0:1,is_animated:r.is_animated?1:0,avatar_url:r.avatar_url??null,created_at:created})}
 case 'ai_defaults':return one('ai_defaults',{id,role:r.role||r.type,name:r.name||r.type,prompt:r.prompt||'',model:text(r.model||b.source.aiModel,'ai_defaults.model or source.aiModel'),created_at:created})
 case 'datasets':case 'knowledge_datasets':{const count=relationships(b).publishedFileCount?.get(String(id))??publishedFiles(r,b).length;const version=r.published_version||(count?`legacy-version:${id}`:null);const refresh=refreshSettings(r);const mapped=one('knowledge_datasets',{id,project_id:project,name:r.name||r.title||id,status:version?'published':'empty',published_version:version,created_at:created,url:r.url??null,...crawlSettings(r,table==='datasets'),...refresh.row},['id'],refresh.hold);if(count&&!r.published_version)mapped.push({table:'knowledge_versions',row:{id:version,dataset_id:id,fingerprint:`legacy:${b.source.revision}:${id}`,created_at:created,semantic:0},key:['id']});return mapped}
 case 'dataset_files':{const dataset=(b.tables.datasets||b.tables.knowledge_datasets||[]).find(d=>String(d.id)===String(r.dataset_id));if(!dataset||!(relationships(b).publishedFile?.has(String(dataset.id),String(id))??publishedFiles(dataset,b).some(file=>String(file.id)===id)))return [];return one('knowledge_documents',{id,version_id:dataset.published_version||`legacy-version:${r.dataset_id}`,url:r.url||r.original_url||`legacy:${id}`,title:r.title||'',content:r.markdown||r.content})}
 case 'knowledge_versions':return one(table,columns(r,['id','dataset_id','fingerprint','created_at','semantic']))
 case 'knowledge_documents':return one(table,columns(r,['id','version_id','url','title','content']))
 case 'categories':case 'knowledge_categories':return one('knowledge_categories',{id,project_id:project,parent_id:r.parent_id===undefined||r.parent_id===null?null:String(r.parent_id),name:r.name||r.title||id,slug:text(r.slug,'categories.slug'),summary:r.summary||'',is_published:r.is_published===false||r.is_published===0||('published_at' in r&&!r.published_at)?0:1,position:Number(r._lft??r.position??0)})
 case 'articles':case 'knowledge_articles':return one('knowledge_articles',{id,project_id:project,category_id:r.category_id??null,slug:text(r.slug,'articles.slug'),title:r.title||r.name||'',content:r.content||'',summary:r.summary||'',status:r.status==='published'||r.published_at||r.is_published?'published':'draft',updated_at:timestamp(r.updated_at||r.created_at),position:Number(r.position||0)})
 case 'article_categories':case 'knowledge_article_categories':return one('knowledge_article_categories',{article_id:String(r.article_id),category_id:String(r.category_id)},['article_id','category_id'])
 case 'insights':{const closed=r.closed_at??r.dismissed_at;return one('context_insights',{id,project_id:project,subject_id:String(r.contact_id),help_type:r.help_type||'legacy',content:r.content||'',buttons:stable(r.buttons||[]),evidence_ids:stable(r.evidence_ids||[]),created_at:created,dismissed_at:closed===undefined||closed===null||closed===''?null:timestamp(closed)})}
 case 'collector_summaries':if(r.summary===undefined)return [];return one('context_summaries',{id,project_id:project,subject_id:String(r.contact_id),summary:r.summary||'',evidence_ids:stable(r.evidence_ids||[]),created_at:created})
 case 'macros':return one('macros',{id,project_id:project,title:r.title||'',content:r.content||'',created_by:text(r.created_by_id||r.created_by,'macros.created_by_id'),created_at:created,updated_at:timestamp(r.updated_at||r.created_at)})
 case 'plugins':return one('plugins',{id,project_id:project,name:r.name||'',url:text(r.url,'plugins.url'),sort_order:Number(r.sort_order||r.position||0),is_enabled:r.is_enabled===undefined?1:truth(r.is_enabled)?1:0,created_at:created})
 case 'collectors':return one('context_collectors',{project_id:project,subject_id:String(r.contact_id),actions_count:Number(r.actions_count||0),analysis_actions:0,analysis_count:Number(r.analysis_count||0),analysis_since_insight:0,job_id:null,last_run_at:r.last_run_at?timestamp(r.last_run_at):null},['project_id','subject_id'],r.running_at?'Imported collector was running; no automatic resumption':undefined)
 case 'collector_actions':if(!r.plaintext_action)return [];return one('context_actions',{id,project_id:project,subject_id:String(r.contact_id),local_id:r.local_id||id,action:typeof r.plaintext_action==='string'?r.plaintext_action:stable(r.plaintext_action),occurred_at:created})
 case 'context_subjects':return one(table,columns(r,['project_id','subject_id','consent','revision','help_types','bot_enabled']),['project_id','subject_id'])
 case 'context_profiles':return one(table,columns(r,['project_id','subject_id','type','profile','evidence_fingerprint','generated_count','started_at']),['project_id','subject_id','type'])
 case 'context_evidence':return one(table,columns(r,['id','project_id','subject_id','source','content','visibility','occurred_at']))
 case 'context_insights':return one(table,columns(r,['id','project_id','subject_id','help_type','content','buttons','evidence_ids','created_at','dismissed_at']))
 default:return undefined
 }
}
