import assert from 'node:assert/strict'
const root='/api/move-in/projects/p/zendesk/diagnostics'
export async function diagnosticsAuthority(h,{addMember,endSession,signIn}){
 const doors=['summary','tickets','articles']
 const refuse=async(path,options,status)=>{const result=await h.raw(path,options);assert.equal(result.response.status,status);assert.equal(result.response.headers.get('Cache-Control'),'no-store');assert.doesNotMatch(JSON.stringify(result.data),/SELECT|synthetic-sensitive|foreign-target|source_json|session_hash/);return result}
 for(const door of doors){await refuse(`${root}/${door}`,{actor:'foreign'},404);await refuse(`${root}/${door}`,{actor:'operator'},403);await refuse(`${root}/${door}`,{headers:{Authorization:'Bearer synthetic-invalid'}},401)}
 await addMember(h,'census-admin','admin')
 await h.db.prepare("INSERT INTO project_roles(project_id,id,name,base,permissions_json,knowledge_article_ids,ticket_scope_json,created_at,updated_at) VALUES('p','census-role','Census reviewer','admin','[]',NULL,NULL,1,1)").run()
 await h.db.prepare("INSERT INTO member_roles(project_id,user_id,role_key,assigned_at) VALUES('p','census-admin','census-role',1)").run()
 for(const door of doors)await refuse(`${root}/${door}`,{actor:'census-admin'},403)
 await h.db.prepare(`UPDATE project_roles SET permissions_json='["data.import"]' WHERE project_id='p' AND id='census-role'`).run()
 for(const door of doors)assert.equal((await h.raw(`${root}/${door}`,{actor:'census-admin'})).response.status,200)
 for(const selection of [{ticket_scope_json:JSON.stringify({groupIds:[],includeUngrouped:false}),knowledge_article_ids:null},{ticket_scope_json:null,knowledge_article_ids:'[]'}]){
  await h.db.prepare("UPDATE project_roles SET ticket_scope_json=?,knowledge_article_ids=? WHERE project_id='p' AND id='census-role'").bind(selection.ticket_scope_json,selection.knowledge_article_ids).run()
  for(const door of doors)await refuse(`${root}/${door}`,{actor:'census-admin'},403)
 }
 await h.db.prepare("DELETE FROM member_roles WHERE project_id='p' AND user_id='census-admin'").run()
 for(const door of doors)assert.equal((await h.raw(`${root}/${door}`,{actor:'census-admin'})).response.status,200)
 await endSession(h,'census-admin')
 for(const door of doors)await refuse(`${root}/${door}`,{actor:'census-admin'},401)
 await signIn(h,'census-admin','admin')
 await h.db.prepare("DELETE FROM memberships WHERE project_id='p' AND user_id='census-admin'").run()
 for(const door of doors)await refuse(`${root}/${door}`,{actor:'census-admin'},401)
 for(const query of ['limit=0','limit=91','limit=all','limit=1&limit=2','cursor=','cursor=not-json','cursor=eyJ2IjoxfQ','cursor='+ 'x'.repeat(4100),'sql=synthetic-sensitive','projectId=q','vendor=intercom','fields=source_json'])await refuse(`${root}/tickets?${query}`,{},400)
 await refuse(`${root}/summary?limit=1`,{},400)
 await refuse(`${root}/articles?export=all`,{},400)
}
