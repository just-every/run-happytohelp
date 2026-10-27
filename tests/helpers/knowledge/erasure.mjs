import assert from 'node:assert/strict'
import {catalogue,policy} from '@runeditrun/rer/modules/portability/catalogue'
import {createPortability} from '@runeditrun/rer/modules/portability'
import {startApp} from '../../journeys/kit/app.mjs'
import {archivePolicy} from '../../../scripts/installer/portability-policy.mjs'

// Extend the existing knowledge journey: native erasure keeps explicit grants
// and provenance, removes personal receipts, and cannot cross workspace scope.
export async function knowledgeErasureJourney(k,{category,article,customer,peer,conversation}){
 const {app,p,call}=k,admin=k.owner.users.admin
 const grant=()=>app.first('SELECT * FROM knowledge_collection_entitlements WHERE project_id=? AND category_id=? AND contact_id=?',p,category,customer)
 await app.db.prepare('UPDATE knowledge_collection_entitlements SET granted_by=? WHERE project_id=? AND category_id=?').bind(admin,p,category).run()
 const before=await grant()
 const otherCategory=(await app.call(`/api/knowledge/${k.other}/categories`,{token:'owner-token-other',body:{title:'Other restricted'},status:201})).data.id
 await app.db.batch([
  app.db.prepare("INSERT INTO contacts(id,project_id,created_at) VALUES('knowledge-other',?,1)").bind(k.other),
  app.db.prepare('UPDATE knowledge_categories SET requires_entitlement=1 WHERE id=?').bind(otherCategory),
  // Deliberately retain the same historical issuer in another workspace.
  app.db.prepare('INSERT INTO knowledge_collection_entitlements VALUES(?,?,?,?,1)').bind(k.other,otherCategory,'knowledge-other',admin),
  app.db.prepare('INSERT INTO knowledge_read_receipts VALUES(?,?,?,?,?,?,?,NULL)').bind('knowledge-personal-receipt',p,article,'fr','brand-private',customer,Date.now()+1800000),
  app.db.prepare('INSERT INTO knowledge_read_receipts VALUES(?,?,?,?,?,NULL,?,?)').bind('knowledge-linked-receipt',p,article,'fr','brand-private',Date.now()+1800000,conversation),
  app.db.prepare('INSERT INTO knowledge_read_receipts VALUES(?,?,?,?,?,?,?,NULL)').bind('knowledge-other-receipt',k.other,article,'en','other','knowledge-other',Date.now()+1800000),
 ])
 const outside=await app.sql('SELECT * FROM knowledge_collection_entitlements WHERE project_id=?',k.other)
 const eraseMember=`/api/management/projects/${p}/agents/${admin}/erase`
 assert.equal((await app.call(eraseMember,{token:k.owner.tokens.operator,body:{}})).status,403)
 assert.equal((await app.call(`/api/management/projects/${k.other}/agents/${admin}/erase`,{token:'owner-token-other',body:{}})).status,409,'another workspace cannot erase this member')
 // The new explicit policy does not relax unknown member-table review.
 await app.db.prepare('CREATE TABLE knowledge_unreviewed_member_test(project_id TEXT REFERENCES projects(id),granted_by TEXT REFERENCES users(id))').run()
 assert.equal((await call(eraseMember,{body:{}})).status,503,'unregistered member references still fail closed')
 assert.deepEqual(await grant(),before)
 assert.ok(await app.first('SELECT 1 FROM memberships WHERE user_id=?',admin))
 await app.db.prepare('DROP TABLE knowledge_unreviewed_member_test').run()
 await app.db.prepare("INSERT INTO memberships VALUES(?,?,'admin')").bind(k.other,admin).run()
 assert.equal((await call(eraseMember,{body:{}})).status,409,'a shared installation account still requires review')
 await app.db.prepare('DELETE FROM memberships WHERE project_id=? AND user_id=?').bind(k.other,admin).run()
 await call(eraseMember,{body:{},status:200})
 assert.deepEqual(await grant(),before,'explicit grant and original opaque provenance survive issuer erasure')
 assert.deepEqual(await app.first('SELECT name,email FROM users WHERE id=?',admin),{name:'Former teammate',email:'erased:'+admin})
 assert.deepEqual(await app.sql('SELECT * FROM knowledge_collection_entitlements WHERE project_id=?',k.other),outside)
 assert.equal((await app.call(`/api/knowledge/public/${p}/articles/secret`,{token:peer.token})).status,404,'issuer erasure never makes a collection public')
 const inventory=await catalogue(app.db,policy(archivePolicy))
 assert.ok(inventory.excludedTables.includes('knowledge_read_receipts'),'portable backup excludes live receipt content')
 assert.ok(inventory.tables.some(row=>row.name==='knowledge_reply_sources'),'portable backup retains compose fences')
 assert.ok(inventory.tables.some(row=>row.name==='knowledge_collection_entitlements'),'portable backup retains explicit grants')
 assert.ok(inventory.tables.find(row=>row.name==='knowledge_categories').columns.some(column=>column.name==='requires_entitlement'),'portable backup retains the restriction flag')
 await knowledgeArchiveRoundtrip(app,{project:p,category,grant:before,outside})
 const fences=await app.sql('SELECT * FROM knowledge_reply_sources WHERE project_id=?',p)
 assert.ok(fences.length,'composition provenance survives sends')
 const otherFences=await app.sql('SELECT ks.* FROM knowledge_reply_sources ks JOIN conversations c ON c.id=ks.conversation_id AND c.project_id=ks.project_id WHERE ks.project_id=? AND c.contact_id<>? ORDER BY ks.conversation_id,ks.source_id,ks.source_version',p,customer)
 const erase=`/api/management/projects/${p}/contacts/${customer}/erase`
 assert.equal((await app.call(erase,{token:k.owner.tokens.operator,body:{}})).status,403)
 await call(erase,{body:{},status:200})
 assert.equal(await grant(),null)
 assert.deepEqual(await app.sql('SELECT ks.* FROM knowledge_reply_sources ks JOIN conversations c ON c.id=ks.conversation_id AND c.project_id=ks.project_id WHERE ks.project_id=? ORDER BY ks.conversation_id,ks.source_id,ks.source_version',p),otherFences,'contact erasure removes only the erased requester’s ticket provenance and preserves every other contact’s fence')
 assert.deepEqual(await app.sql('SELECT token FROM knowledge_read_receipts WHERE project_id=?',p),[],'personal and conversation-linked receipts are erased')
 assert.ok(await app.first("SELECT token FROM knowledge_read_receipts WHERE token='knowledge-other-receipt'"))
 assert.equal((await app.first('SELECT requires_entitlement FROM knowledge_categories WHERE id=?',category)).requires_entitlement,1,'erasing the last entitled contact keeps the collection restricted')
 assert.equal((await app.call(`/api/knowledge/public/${p}/articles/secret`,{token:peer.token})).status,404)
 await call(erase,{body:{},status:200})
 assert.deepEqual(await app.sql('SELECT * FROM knowledge_collection_entitlements WHERE project_id=?',k.other),outside,'repeat erasure preserves other workspaces')
}

async function knowledgeArchiveRoundtrip(app,{project,category,grant,outside}){
 const fences=await app.sql('SELECT * FROM knowledge_reply_sources ORDER BY project_id,conversation_id,source_id,source_version')
 const portable=async app=>createPortability({db:app.db,buckets:{FILES:await app.files},policy:archivePolicy})
 const transfer=await portable(app),id=await transfer.exports.create()
 let status
 do{status=await transfer.exports.advance(id,{maxParts:100})}while(status.phase!=='complete')
 const bytes=await new Response(await transfer.exports.download(id)).text(),records=bytes.trim().split('\n').map(JSON.parse)
 assert.ok(!bytes.includes('knowledge-personal-receipt')&&!bytes.includes('knowledge-linked-receipt')&&!bytes.includes('knowledge-other-receipt'),'portable bytes carry no receipt content')
 const destination=await startApp()
 try{
  const restored=await portable(destination),importId=await restored.imports.create(records[0])
  for(const part of records.filter(row=>row.kind==='part'))await restored.imports.uploadPart(importId,part.index,part)
  const closing=records.at(-1)
  assert.equal((await restored.imports.finalize(importId,{archiveHash:closing.archiveHash,contentHash:closing.contentHash})).phase,'complete')
  assert.equal((await destination.first('SELECT count(*) n FROM knowledge_read_receipts')).n,0)
  assert.deepEqual(await destination.sql('SELECT * FROM knowledge_reply_sources ORDER BY project_id,conversation_id,source_id,source_version'),fences,'restored compose fences cannot widen access')
  assert.deepEqual(await destination.first('SELECT * FROM knowledge_collection_entitlements WHERE project_id=? AND category_id=?',project,category),grant,'portable restore retains explicit entitlement provenance')
  assert.deepEqual(await destination.sql('SELECT * FROM knowledge_collection_entitlements WHERE project_id<>?',project),outside)
  assert.equal((await destination.first('SELECT requires_entitlement FROM knowledge_categories WHERE id=?',category)).requires_entitlement,1)
  assert.equal((await destination.call(`/api/knowledge/public/${project}/articles/secret`)).status,404,'restoring grants never makes restricted knowledge public')
 }finally{await destination.close()}
}
