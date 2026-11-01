import assert from 'node:assert/strict';

const parse=rows=>(rows||[]).map(JSON.parse);
const canonical=rows=>rows.map(row=>JSON.stringify(Object.fromEntries(Object.entries(row).sort(([a],[b])=>a.localeCompare(b))))).sort();

// These migrations intentionally seed source custody and pending upgrade work.
// Compare the complete rows to the pre-upgrade sources instead of treating the
// new authoritative metadata as fabricated user data or ignoring its tables.
export function assertReferenceUpgrade(table,serialized,before,final,startedAt,finishedAt){
 const rows=parse(serialized),articles=parse(before.knowledge_articles),projects=parse(before.projects);
 let expected;
 if(table==='knowledge_article_publications')expected=articles.filter(article=>article.status==='published').map(article=>({project_id:article.project_id,article_id:article.id,source_version:article.publication_version,snapshot_json:JSON.stringify({title:article.title,slug:article.slug,content:article.content,summary:article.summary}),created_at:article.updated_at}));
 else if(table==='knowledge_generation_sources')expected=parse(before.ai_generation_sources).map(({generation_id,project_id,source_id,source_version})=>({generation_id,project_id,source_id,source_version}));
 else if(table==='knowledge_index_dirty'){
  const versions=new Map(parse(before.knowledge_versions).map(row=>[row.id,row]));
  const datasets=new Map(parse(before.knowledge_datasets).map(row=>[row.id,row]));
  const retained=new Set([
   ...parse(before.knowledge_article_history).filter(row=>JSON.parse(row.snapshot_json).status==='published').map(row=>row.article_id),
   ...parse(final.knowledge_article_publications).map(row=>row.article_id),
   ...parse(final.knowledge_translation_publications).map(row=>row.article_id),
   ...parse(before.knowledge_translations).filter(row=>row.published_json!==null).map(row=>row.article_id),
  ]);
  const sources=articles.filter(article=>article.status==='published'||retained.has(article.id)).map(article=>({project_id:article.project_id,source_id:'article:'+article.id,stamp:''}));
  for(const document of parse(before.knowledge_documents)){const version=versions.get(document.version_id),dataset=datasets.get(version?.dataset_id);assert.ok(dataset,'indexed document has its retained dataset');sources.push({project_id:dataset.project_id,source_id:'knowledge:'+document.id,stamp:''});}
  for(const generation of parse(final.knowledge_generation_sources))sources.push({project_id:generation.project_id,source_id:'generation:'+generation.generation_id,stamp:''});
  expected=[...new Map(sources.map(row=>[row.project_id+'\0'+row.source_id,row])).values()];
 }else if(table==='knowledge_upgrade_reports'){
  const categories=new Map(parse(final.knowledge_categories).map(row=>[row.id,row]));
  const links=parse(final.knowledge_article_categories);
  expected=projects.map(project=>{
   const unpublishedArticles=articles.filter(article=>article.project_id===project.id).filter(article=>{
    const lineage=[article.category_id,...links.filter(link=>link.article_id===article.id).map(link=>link.category_id)],seen=new Set();
    while(lineage.length){const id=lineage.pop();if(!id||seen.has(id))continue;seen.add(id);const category=categories.get(id);if(category?.is_published!==1)return true;if(category.parent_id)lineage.push(category.parent_id);}
    return false;
   }).map(article=>article.id).sort();
   const actual=rows.find(row=>row.project_id===project.id);assert.ok(actual,'every existing workspace has a pending upgrade report');
   const report=JSON.parse(actual.report_json);assert.deepEqual(Object.keys(report),['unpublishedArticles']);assert.deepEqual([...report.unpublishedArticles].sort(),unpublishedArticles,'upgrade report names precisely the articles withdrawn by collection publication');
   return {project_id:project.id,report_json:actual.report_json,completed_at:null};
  });
 }else if(table==='knowledge_upgrade_progress')expected=projects.map(project=>{
  const actual=rows.find(row=>row.project_id===project.id);assert.ok(actual,'every pending workspace has durable upgrade work');
  assert.ok(Number.isInteger(actual.updated_at)&&actual.updated_at>=Math.floor(startedAt/1000)*1000&&actual.updated_at<=finishedAt,'upgrade cursor is timestamped during migration');
  return {project_id:project.id,table_name:'',row_key:'',schema_json:'[]',schema_cursor:0,canonicalised_rows:0,changed_rows:0,lease_token:null,lease_expires_at:null,queued_at:null,updated_at:actual.updated_at};
 });
 else return false;
 assert.deepEqual(canonical(rows),canonical(expected),'knowledge upgrade preserves exact source custody and declares only pending work: '+table);
 return true;
}
