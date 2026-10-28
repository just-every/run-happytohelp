import assert from 'node:assert/strict';

export async function upgradeReport({app,p,owner,other,call},article) {
 const path=`/api/knowledge/${p}/upgrade-report`,source=await app.first('SELECT title,content FROM knowledge_articles WHERE id=?',article);
 // Historical report metadata is a migration fixture; the route reads it through the real authorization boundary.
 await app.db.prepare("UPDATE knowledge_upgrade_reports SET report_json=json_set(report_json,'$.unpublishedArticles',json(?)) WHERE project_id=?").bind(JSON.stringify([article,article,'removed-source']),p).run();
 for(const token of [owner.tokens.owner,owner.tokens.admin]){
  const {data}=await app.call(path,{token,status:200});
  assert.equal(data.affectedArticleCount,2);
  assert.equal(data.unavailableArticleCount,1);
  assert.deepEqual(data.unpublishedArticles,[{id:article,title:source.title,editorPath:`/projects/${p}/articles/${article}`}]);
  assert.ok(!JSON.stringify(data).includes(source.content),'the report contains metadata, never article bodies');
  assert.ok(!JSON.stringify(data).includes('removed-source'),'deleted identifiers are concealed');
  assert.equal((await app.call(`${path}?after=${encodeURIComponent(article)}`,{token,status:200})).data.unpublishedArticles.length,0);
 }
 assert.equal((await app.call(path,{token:owner.tokens.operator})).status,403,'an Agent cannot read upgrade metadata');
 assert.equal((await app.call(`/api/knowledge/${other}/upgrade-report`,{token:owner.tokens.owner})).status,403,'another workspace is denied');
 assert.equal((await app.call(path)).status,401);
 // Restore clears completion while retaining historical JSON; the endpoint must show pending again.
 const report=await app.first('SELECT * FROM knowledge_upgrade_reports WHERE project_id=?',p);
 await app.db.prepare("UPDATE knowledge_upgrade_reports SET completed_at=NULL,report_json=json_set(report_json,'$.status','completed') WHERE project_id=?").bind(p).run();
 assert.equal((await call(path,{status:200})).data.status,'pending');
 await app.db.prepare('UPDATE knowledge_upgrade_reports SET report_json=?,completed_at=? WHERE project_id=?').bind(report.report_json,report.completed_at,p).run();
}
