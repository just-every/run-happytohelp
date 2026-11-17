import type {LegacyBundle,Row} from './types'
import {relationships} from './relationships'
/** The exporter promises a self-contained project scope. Reject broken original
 * source FKs before writes, including a parent held only in package context.
 * Enriched/native manual bundles retain their separate schema guard policy. */
const parents:Record<string,Record<string,string>>={
 contacts:{project_id:'projects'},
 conversations:{project_id:'projects',contact_id:'contacts'},
 messages:{project_id:'projects',conversation_id:'conversations',bucket_id:'buckets',contact_id:'contacts',agent_id:'users'},
 buckets:{project_id:'projects',conversation_id:'conversations'},
 events:{conversation_id:'conversations',bucket_id:'buckets',contact_id:'contacts',agent_id:'users'},
 categories:{project_id:'projects',parent_id:'categories'},
 articles:{project_id:'projects'},
 article_categories:{article_id:'articles',category_id:'categories'},
 dataset_files:{project_id:'projects',dataset_id:'datasets'},
 macros:{project_id:'projects',created_by_id:'users'},
}
export function validateSourceReferences(table:string,row:Row,context:LegacyBundle,complete=false){
 if(context.source.repository!=='happytohelp')return
 const related=relationships(context)
 for(const [field,parent] of Object.entries(parents[table]??{})){
  if(!complete&&!(Array.isArray(context.source.referenceTables)&&context.source.referenceTables.includes(parent)))continue
  const value=row[field]
  if(value!=null&&value!==''&&!related.find(parent,value))throw new Error(`Missing legacy source parent: ${table}.${field}`)
 }
 if(table==='categories'){
  const seen=new Set<string>();let current:Row|undefined=row
  while(current){const id=String(current.id);if(seen.has(id))throw new Error('Category parent cycle');seen.add(id);current=current.parent_id==null?undefined:related.find('categories',current.parent_id)}
 }
}
