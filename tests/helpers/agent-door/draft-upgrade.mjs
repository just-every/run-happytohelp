import assert from 'node:assert/strict'
import {startApp,applyMigrations} from '../../journeys/kit/app.mjs'

/** Stage an actual prior-schema native draft, upgrade in place and read it through
 * the staff composer. Existing macro receipts and content must survive exactly. */
export async function draftUpgradeJourney(){
 const app=await startApp({migrate:name=>parseInt(name,10)<281})
 try{
  const workspace=await app.seedWorkspace('synthetic-happytohelp-draft-upgrade'),project=workspace.projectId,actor=workspace.users.owner
  const native=(path,options={})=>app.ok(path,{token:workspace.tokens.owner,...options})
  const P=`/api/management/projects/${project}`,D=`/api/dashboard/projects/${project}`
  const contact=(await native(P+'/contacts',{body:{name:'Synthetic prior draft customer'}})).data
  const ticket=await native('/api/conversations',{body:{projectId:project,contactId:contact.id}})
  const macro=(await native(P+'/macros',{body:{title:'Synthetic retained reply',content:'Synthetic retained native draft'}})).data
  await app.db.batch([
   app.db.prepare('INSERT INTO macro_usage(id,project_id,macro_id,version,conversation_id,actor_id,command_id,created_at) VALUES(?,?,?,?,?,?,?,?)').bind('synthetic-prior-use',project,macro.id,macro.version,ticket.id,actor,'synthetic-prior-command',1),
   app.db.prepare("INSERT INTO macro_drafts VALUES(?,?,?,? ,?,'public','[]','[]',1)").bind(project,ticket.id,actor,'synthetic-prior-use','Synthetic retained native draft'),
  ])
  const path=D+'/conversations/'+ticket.id+'/macro-draft',before=(await native(path)).data
  const history=await app.sql('SELECT * FROM macro_usage')
  await applyMigrations(app.db,name=>parseInt(name,10)===281)
  assert.deepEqual((await native(path)).data,before)
  assert.deepEqual(await app.sql('SELECT * FROM macro_usage'),history)
  assert.equal((await app.first('SELECT draft_id FROM macro_drafts')).draft_id,null)
  const oldVersion=before.usage_id
  await app.db.prepare('UPDATE macro_drafts SET usage_id=NULL,draft_id=?').bind('synthetic-direct-version').run()
  assert.equal((await native(path+'?usage_id='+oldVersion,{method:'DELETE'})).data.discarded,false)
  assert.equal((await native(path)).data.usage_id,'synthetic-direct-version')
  assert.equal((await native(path+'?usage_id=synthetic-direct-version',{method:'DELETE'})).data.discarded,true)
  assert.equal((await native(path)).data,null)
 }finally{await app.close()}
 console.log('PROBE migration: prior native macro draft -> migration 281 -> identical staff draft and macro-use history')
}
