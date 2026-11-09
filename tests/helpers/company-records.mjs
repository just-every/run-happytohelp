import {customerOutcomes} from './customer-outcomes.mjs'
import assert from 'node:assert/strict'
import {createHmac} from 'node:crypto'
import {startApp,sha} from '../journeys/kit/app.mjs'
import {build} from 'esbuild'

export async function companyRecordsJourney(){
 await customerOutcomes()
 const app=await startApp({captureQueue:true}),w=await app.seedWorkspace('companies'),other=await app.seedWorkspace('foreign-companies'),p=w.projectId,owner={token:w.tokens.owner},B=`/api/management/projects/${p}`
 try{
  const defs={}
  for(const [type,value,options] of [['text','US distribution'],['number',125],['date','2026-10-20'],['dropdown','Enterprise',['Standard','Enterprise']],['checkbox',true]]){
   const field=(await app.ok(B+'/company-fields',{...owner,body:{name:type,type,...(options?{options}:{})}})).field
   defs[type]={field,value}
  }
  const attributes=Object.fromEntries(Object.values(defs).map(({field,value})=>[field.id,value]))
  const company=(await app.ok(B+'/companies',{...owner,body:{name:'Northstar Supply',domains:['northstar.example'],attributes}})).company
  assert.equal(company.portalCompanyView,false)
  assert.deepEqual(company.attributes,attributes)
  assert.equal((await app.call(`${B}/companies/${company.id}`,{...owner,method:'PATCH',body:{attributes:{[defs.number.field.id]:'invalid'}}})).status,400)
  const contacts=[]
  for(const name of ['Alex','Bea','Chen']){
   const contact=(await app.ok(B+'/contacts',{...owner,body:{name,email:name.toLowerCase()+'@northstar.example'}})).data;contacts.push(contact)
   await app.ok(`${B}/companies/${company.id}/members/${contact.id}`,{...owner,method:'PUT',body:{}})
  }
  const source=(await app.ok(B+'/companies',{...owner,body:{name:'Northstar West',domains:['west.example'],attributes:{[defs.number.field.id]:50},portalCompanyView:true}})).company
  const preview=(await app.ok(`${B}/companies/${company.id}/merge/preview`,{...owner,body:{sourceId:source.id}})).preview
  await app.ok(`${B}/agents/${w.users.operator}`,{...owner,method:'PUT',body:{role:'collaborator'}})
  assert.equal((await app.call(`${B}/companies/${company.id}/merge/preview`,{token:w.tokens.operator,body:{sourceId:source.id}})).status,403)
  assert.ok(preview.conflicts.some(conflict=>conflict.fieldId===defs.number.field.id))
  const path=`${B}/companies/${company.id}/merge`,mergeBody={sourceId:source.id,preview}
  await app.db.prepare('UPDATE session_factors SET verified_at=1 WHERE token_hash=?').bind(sha(w.tokens.owner)).run()
  assert.equal((await app.call(path,{...owner,body:mergeBody})).data.code,'step_up_required')
  await app.db.prepare('UPDATE session_factors SET verified_at=? WHERE token_hash=?').bind(Date.now(),sha(w.tokens.owner)).run()
  const merged=await app.ok(path,{...owner,body:mergeBody})
  assert.equal(merged.company.portalCompanyView,false)
  assert.deepEqual(merged.domains,['northstar.example','west.example'])
  assert.equal(merged.members.length,3)
  assert.equal((await app.call(`/api/management/projects/${other.projectId}/companies/${company.id}`,{token:other.tokens.owner})).status,404)
  assert.equal((await app.call(`${B}/companies/${source.id}`,owner)).status,404)
  assert.ok(merged.history.some(row=>row.action==='merged'&&row.provenance))
  await app.ok(`${B}/companies/${company.id}/history/${merged.historyId}/undo`,{...owner,body:{}})
  assert.equal((await app.ok(`${B}/companies/${source.id}`,owner)).company.name,'Northstar West')
  const stale=(await app.ok(`${B}/companies/${company.id}/merge/preview`,{...owner,body:{sourceId:source.id}})).preview
  await app.ok(`${B}/companies/${source.id}`,{...owner,method:'PATCH',body:{name:'Northstar Pacific'}})
  assert.equal((await app.call(path,{...owner,body:{sourceId:source.id,preview:stale}})).status,409)
  // Identity associations are a separate, reviewed operator record. They never
  // merge sessions, transfer conversations or make typed email into proof.
  const secret=(await app.first('SELECT verification_secret FROM projects WHERE id=?',p)).verification_secret
  const signed=async identifier=>app.ok('/api/identity/widget/session',{body:{widgetKey:w.widgetKey,identifier,contact_hash:createHmac('sha256',secret).update(identifier).digest('hex'),name:identifier},headers:{Origin:w.allowedOrigin}})
  const [alice,social]=await Promise.all([signed('synthetic-happytohelp-1'),signed('synthetic-happytohelp-2')])
  const linkPath=`${B}/contacts/${alice.contactId}/identity-links`,intent={action:'link',contact_id:social.contactId,provenance:'Verified source support request synthetic-happytohelp-3'}
  const review=(await app.ok(linkPath+'/preview',{...owner,body:intent})).preview
  assert.equal(review.grants_customer_access,false)
  assert.ok(review.contacts.every(c=>c.proof==='signed_widget'))
  assert.equal((await app.ok(linkPath,owner)).links.length,0,'preview has no effect')
  assert.equal((await app.call(linkPath,{token:w.tokens.operator,body:review})).status,403,'collaborator cannot link identities')
  assert.equal((await app.call(linkPath,{token:alice.token,body:review})).status,403,'a customer cannot link another identity')
  assert.equal((await app.call(linkPath+'/preview',{...owner,body:{...intent,contact_id:contacts[1].id}})).status,409,'typed email has no identity proof')
  assert.equal((await app.call(`/api/management/projects/${other.projectId}/contacts/${alice.contactId}/identity-links/preview`,{token:other.tokens.owner,body:intent})).status,404)
  await app.db.prepare('UPDATE contacts SET name=? WHERE id=?').bind('Changed identity',social.contactId).run()
  assert.equal((await app.call(linkPath,{...owner,body:review})).status,409,'changed identity invalidates its preview')
  const apply=async body=>app.ok(linkPath,{...owner,body:(await app.ok(linkPath+'/preview',{...owner,body})).preview})
  const authorityReview=(await app.ok(linkPath+'/preview',{...owner,body:intent})).preview
  const refused=await app.call(linkPath,{...owner,body:authorityReview,headers:{'x-test-before-batch':`UPDATE sessions SET revoked_at=1 WHERE token_hash='${sha(w.tokens.owner)}'`}})
  assert.equal(refused.status,409,'the durable claim rechecks the live session')
  assert.equal((await app.first('SELECT count(*) n FROM customer_identity_links WHERE project_id=?',p)).n,0)
  await app.db.prepare('UPDATE sessions SET revoked_at=NULL WHERE token_hash=?').bind(sha(w.tokens.owner)).run()
  const proofReview=(await app.ok(linkPath+'/preview',{...owner,body:intent})).preview
  assert.equal((await app.call(linkPath,{...owner,body:proofReview,headers:{'x-test-before-batch':`UPDATE contacts SET is_verified=0 WHERE id='${social.contactId}'`}})).status,409,'verification loss at commit cannot install an association')
  await app.db.prepare('UPDATE contacts SET is_verified=1 WHERE id=?').bind(social.contactId).run()
  await apply(intent)
  await app.configure({})
  const linked=await app.ok(linkPath,owner),reverse=await app.ok(`${B}/contacts/${social.contactId}/identity-links`,owner)
  assert.equal(linked.links[0].contact.id,social.contactId);assert.equal(reverse.links[0].contact.id,alice.contactId)
  assert.equal(linked.links[0].provenance,intent.provenance)
  assert.equal(linked.links[0].actor_id,w.users.owner,'the reviewer is kept with the link')
  const ticket=await app.ok('/api/conversations',{token:alice.token,body:{projectId:p}})
  assert.equal((await app.call(`/api/conversations/${ticket.id}/messages`,{token:social.token})).status,404,'linked identity gains no other customer history')
  const reason='Customer confirmed separate accounts synthetic-happytohelp-4'
  await apply({...intent,action:'unlink',provenance:reason})
  const unlinked=await app.ok(linkPath,owner)
  assert.equal(unlinked.links.length,0)
  // Unlinking keeps both decisions with reviewer, time and evidence, from either side.
  assert.deepEqual(unlinked.history.map(entry=>[entry.action,entry.provenance,entry.actor_id,entry.contact.id]),[['unlinked',reason,w.users.owner,social.contactId],['linked',intent.provenance,w.users.owner,social.contactId]])
  assert.ok(unlinked.history[0].at>=unlinked.history[1].at)
  assert.deepEqual((await app.ok(`${B}/contacts/${social.contactId}/identity-links`,owner)).history.map(entry=>entry.contact.id),[alice.contactId,alice.contactId])
  await apply(intent)
  assert.equal((await app.sql("SELECT action FROM audit_events WHERE project_id=? AND action IN ('customer.identity_linked','customer.identity_unlinked')",p)).length,3)
  assert.equal(app.requests.length,0,'identity review sends nothing')
  await apply({...intent,action:'unlink'})
  const provenanceIntent={...intent,provenance:`Verified in support request from ${contacts[0].email}`}
  const priorErasureReview=(await app.ok(linkPath+'/preview',{...owner,body:provenanceIntent})).preview
  await app.ok(linkPath,{...owner,body:priorErasureReview})
  await app.ok(`${B}/contacts/${contacts[0].id}/erase`,{...owner,body:{}})
  assert.equal((await app.ok(linkPath,owner)).links.length,0,'erasure removes free-text provenance naming a third customer')
  assert.ok(!(await app.ok(linkPath,owner)).history.some(entry=>entry.provenance.includes(contacts[0].email)),'erasure removes decisions whose evidence names the erased customer')
  assert.equal((await app.call(linkPath,{...owner,body:priorErasureReview})).status,409,'a pre-erasure preview cannot reinstall removed provenance')
  const reviewedAgain=(await app.ok(linkPath+'/preview',{...owner,body:intent})).preview
  const erasedAtCommit=await app.call(linkPath,{...owner,body:reviewedAgain,headers:{'x-test-before-batch':`UPDATE contact_erasures SET runs=runs+1 WHERE project_id='${p}' AND contact_id='${contacts[0].id}'`}})
  assert.equal(erasedAtCommit.status,409,'erasure winning the write transaction also invalidates the preview')
  assert.equal((await app.ok(linkPath,owner)).links.length,0)
  await apply(intent)
  await app.ok(`${B}/contacts/${social.contactId}/erase`,{...owner,body:{}})
  assert.equal((await app.ok(linkPath,owner)).links.length,0,'erasure removes associations from both sides')
  assert.equal((await app.first('SELECT count(*) n FROM customer_identity_link_history WHERE project_id=?',p)).n,0,'erasure removes every decision naming the erased identity')
  // Erasure clears active membership and every undo snapshot that could restore it.
  await app.ok(`${B}/contacts/${contacts[0].id}/erase`,{...owner,body:{}})
  assert.equal(await app.first('SELECT * FROM contact_companies WHERE project_id=? AND contact_id=?',p,contacts[0].id),null)
  assert.equal((await app.sql('SELECT before_json,after_json,provenance_json FROM company_history WHERE project_id=?',p)).some(row=>JSON.stringify(row).includes(contacts[0].id)),false)
  assert.ok((await app.sql("SELECT action FROM audit_events WHERE project_id=? AND action LIKE 'company.%'",p)).length>0)
  await companyDetailProof(app)
 }finally{await app.close()}
}

// The company page answers the members and tickets of the statements it ran before it was bounded, run here directly
// as an oracle (test code only): every member and every ticket, in the same order, for an owner and a scoped agent.
const predicates=()=>build({stdin:{contents:"export {ticketScopeSql} from './src/modules/access/ticket-scope.ts';export {contactAvailableSql} from './src/modules/conversations/contact-privacy.ts';export {contactWritable} from './src/platform/contact-state.ts'",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',logLevel:'silent'}).then(result=>import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64')))
async function companyDetailProof(app){
 const {ticketScopeSql,contactAvailableSql,contactWritable}=await predicates()
 const w=await app.seedWorkspace('company-page'),p=w.projectId,owner={token:w.tokens.owner},B=`/api/management/projects/${p}`,detail=id=>`${B}/companies/${id}`
 const role=(await app.ok(B+'/roles',{...owner,body:{name:'Scoped company reader',base:'operator',permissions:['contacts.manage']}})).data.id
 await app.ok(`${B}/agents/${w.users.operator}`,{...owner,method:'PUT',body:{role}})
 await app.db.prepare('INSERT INTO ticket_groups(id,project_id,name,updated_at) VALUES(?,?,?,1)').bind('company-page-group',p,'Company page group').run()
 await app.db.prepare('UPDATE project_roles SET ticket_scope_json=? WHERE project_id=? AND id=?').bind(JSON.stringify({groupIds:['company-page-group'],includeUngrouped:false}),p,role).run()
 const today={
  members:`SELECT id,name,email,external_id,created_at FROM contacts WHERE project_id=? AND id IN (SELECT contact_id FROM contact_companies WHERE project_id=? AND company_id=?) AND ${contactWritable} ORDER BY name,email,id`,
  tickets:`SELECT c.id,c.contact_id,c.subject,c.status_id,c.status_category,c.priority,c.assigned_to,c.created_at,c.updated_at,co.name contact_name,co.email contact_email FROM conversations c JOIN contact_companies cc ON cc.project_id=c.project_id AND cc.contact_id=c.contact_id JOIN contacts co ON co.project_id=c.project_id AND co.id=c.contact_id WHERE c.project_id=? AND cc.company_id=? AND ${contactAvailableSql()} AND ${ticketScopeSql('?')} ORDER BY c.updated_at DESC,c.id`,
 }
 // Undo is offered while every company an entry changed is still as the entry left it, as read today.
 const participants="SELECT c.*,(SELECT json_group_array(domain) FROM (SELECT domain FROM company_domains WHERE project_id=c.project_id AND company_id=c.id ORDER BY domain)) domains_json,(SELECT json_group_array(contact_id) FROM (SELECT contact_id FROM contact_companies WHERE project_id=c.project_id AND company_id=c.id ORDER BY contact_id)) members_json FROM companies c WHERE c.project_id=? AND c.id IN (SELECT value FROM json_each(?))"
 const undoable=async id=>{
  const history=await app.sql('SELECT * FROM company_history WHERE project_id=? AND (company_id=? OR source_company_id=?) ORDER BY at DESC,id DESC LIMIT 200',p,id,id),states=new Map()
  for(const {domains_json,members_json,...company} of await app.sql(participants,p,JSON.stringify([...new Set(history.flatMap(h=>JSON.parse(h.after_json).map(s=>s.company.id)))])))states.set(company.id,JSON.stringify({company,domains:JSON.parse(domains_json),members:JSON.parse(members_json)}))
  return history.map(h=>!h.undone_by&&JSON.parse(h.before_json).length>0&&JSON.parse(h.after_json).every(s=>states.get(s.company.id)===JSON.stringify(s)))
 }
 const readers=[[w.tokens.owner,w.users.owner],[w.tokens.operator,w.users.operator]]
 const same=async(label,...ids)=>{for(const id of ids)for(const [token,userId] of readers){
  const answer=await app.ok(detail(id),{token}),count=(await app.first('SELECT count(*) n FROM contact_companies WHERE project_id=? AND company_id=?',p,id)).n
  assert.equal(JSON.stringify(answer.members),JSON.stringify(await app.sql(today.members,p,p,id)),`${label}: members of ${id}`)
  assert.equal(JSON.stringify(answer.tickets),JSON.stringify(await app.sql(today.tickets,p,id,userId)),`${label}: tickets of ${id}`)
  assert.equal(answer.company.memberCount,count,`${label}: member count of ${id}`)
  assert.deepEqual(answer.history.map(h=>h.canUndo),await undoable(id),`${label}: undo offered for ${id}`)
  if(token===w.tokens.owner)assert.ok(answer.tickets.length>0,`${label}: ${id} has tickets to compare`)
 }}
 const company=async(name,domain)=>(await app.ok(B+'/companies',{...owner,body:{name,domains:[domain]}})).company.id
 const harbor=await company('Harbor Supply','harbor.example'),west=await company('Harbor West','harbor-west.example')
 // Members with tied and missing names, tickets with tied update times and some in a group the scoped agent sees.
 const people=[['Avery','avery@harbor.example',harbor,2],['Avery','avery.b@harbor.example',harbor,1],[null,'no-name@harbor.example',harbor,3],['Blake','blake@harbor.example',harbor,0],['Casey','casey@harbor.example',harbor,2],['Drew','drew@harbor-west.example',west,2],['Emery','emery@harbor-west.example',west,1],['Finley','finley@harbor.example',null,2]]
 const ids=[]
 for(const [index,[name,email,companyId,tickets]] of people.entries()){
  const id=(await app.ok(B+'/contacts',{...owner,body:{...(name?{name}:{}),email}})).data.id;ids.push(id)
  if(companyId)await app.ok(`${detail(companyId)}/members/${id}`,{...owner,method:'PUT',body:{}})
  for(let n=0;n<tickets;n++)await app.db.prepare("INSERT INTO conversations(id,project_id,contact_id,subject,status_id,status_category,priority,group_id,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,1,?,?)").bind(`company-page-ticket-${index}-${n}`,p,id,`Ticket ${index}.${n}`,n?'open':'new',n?'open':'new',n===2?'high':'normal',(index+n)%3===0?'company-page-group':null,1000+n,2000+((index*7+n)%4)).run()
 }
 await same('initial',harbor,west)
 const erasing=value=>app.db.prepare("UPDATE contacts SET metadata_json=json_set(metadata_json,'$.is_erasing',?) WHERE id=?").bind(value,ids[4]).run()
 // A member being erased stays counted, is never listed and its tickets are hidden.
 await erasing(1);await same('a member being erased',harbor);await erasing(0)
 await app.ok(`${detail(harbor)}/members/${ids[7]}`,{...owner,method:'PUT',body:{}})
 await same('member linked',harbor,west)
 await app.ok(`${detail(harbor)}/members/${ids[5]}`,{...owner,method:'PUT',body:{}})
 await same('member moved from another company',harbor,west)
 await app.ok(`${detail(harbor)}/members/${ids[1]}`,{...owner,method:'DELETE',body:{}})
 await same('member unlinked',harbor,west)
 await app.db.prepare('UPDATE session_factors SET verified_at=? WHERE token_hash=?').bind(Date.now(),sha(w.tokens.owner)).run()
 const preview=(await app.ok(`${detail(harbor)}/merge/preview`,{...owner,body:{sourceId:west}})).preview
 const merged=await app.ok(`${detail(harbor)}/merge`,{...owner,body:{sourceId:west,preview}})
 assert.equal(JSON.stringify(merged.tickets),JSON.stringify(await app.sql(today.tickets,p,harbor,w.users.owner)),'the merge answers the merged company\'s tickets')
 await same('merged',harbor)
 for(const id of [west,'company-page-unknown'])assert.equal((await app.call(detail(id),owner)).status,404,`${id} is not found`)
 const undone=await app.ok(`${detail(harbor)}/history/${merged.historyId}/undo`,{...owner,body:{}})
 assert.equal(JSON.stringify(undone.members),JSON.stringify(await app.sql(today.members,p,p,harbor)),'the undo answers the restored members')
 await same('merge undone',harbor,west)
 // D1's overload at every D1 call the company page makes (counted on a calm read): two refusals are retried to the
 // same answer; refused throughout, it answers 503 with Retry-After and a JSON error, never 500.
 const calm=await app.call(detail(harbor),{...owner,headers:{'x-test-meter-d1':'1'}}),count=Number(calm.headers.get('x-test-d1-statements'))
 assert.equal(calm.status,200);assert.ok(count>0,'the company page reads D1')
 const fault=(at,overloads)=>({...owner,headers:{'x-test-fault':'d1-overloaded','x-test-statement-at':String(at),...(overloads?{'x-test-overloads':String(overloads)}:{})}})
 for(let at=1;at<=count;at++){
  const passing=await app.call(detail(harbor),fault(at,2))
  assert.equal(passing.status,200,`passing overload at ${at}`);assert.equal(JSON.stringify(passing.data),JSON.stringify(calm.data),`the company page answers the same after a passing overload at ${at}`)
  const refused=await app.call(detail(harbor),fault(at))
  assert.equal(refused.status,503,`refused at ${at}: ${JSON.stringify(refused.data)}`);assert.equal(typeof refused.data.error,'string')
  const wait=Number(refused.headers.get('retry-after'));assert.ok(Number.isInteger(wait)&&wait>=1&&wait<=30,'Retry-After is whole seconds within D1\'s window')
 }
}
