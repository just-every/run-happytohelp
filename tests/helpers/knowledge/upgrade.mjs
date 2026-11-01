import assert from 'node:assert/strict';

// R7 adds metadata to existing rows. Every original field remains byte-exact.
export function knowledgeUpgradeDefaults(table, row) {
 if(table==='knowledge_articles')return {...row,editor_id:null};
 if(table==='knowledge_categories')return {...row,audience:'public',allowed_domains:'[]',requires_entitlement:0};
 return row;
}

// Existing articles receive real version snapshots, rather than fabricated content.
export function assertKnowledgeHistoryBackfill(serialized, priorArticles) {
 const articles=new Map(priorArticles.map(value=>{const row=JSON.parse(value);return [row.id,row]}));
 const rows=serialized.map(JSON.parse);
 assert.equal(rows.length,articles.size,'one initial version per retained article');
 assert.equal(new Set(rows.map(row=>row.id)).size,rows.length,'version identities are distinct');
 assert.equal(new Set(rows.map(row=>row.article_id)).size,articles.size,'every retained article is versioned once');
 for(const row of rows){
  const article=articles.get(row.article_id);assert.ok(article,'history refers to a retained article');
  assert.ok(row.id,'version identity is present');
  assert.equal(row.project_id,article.project_id);
  assert.equal(row.editor_id,null,'an upgrade never invents an editor');
  assert.equal(row.created_at,article.updated_at);
  assert.deepEqual(JSON.parse(row.snapshot_json),{
   slug:article.slug,title:article.title,content:article.content,summary:article.summary,status:article.status,
  },'history retains the exact published or draft content');
 }
}
