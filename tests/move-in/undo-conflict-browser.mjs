import assert from 'node:assert/strict'

/** Real Settings uploads, native membership/edit/reference doors, and the owner’s
 * Undo button. Desktop assertions run once; phone images show the same result. */
export async function undoConflictBrowser({page,origin,project,shot}){
 const base=`/projects/${project}`,api=`/api/management/projects/${project}`
 const call=async(path,body,method=body===undefined?'GET':'POST')=>{
  const r=await page.request.fetch(origin+path,{method,...body===undefined?{}:{data:body}})
  assert.ok(r.ok(),`${method} ${path} ${r.status()}`);return r.json()
 }
 const stamp='2024-01-01T00:00:00Z'
 const staff={id:910001,role:'agent',name:'Sam Ortiz',email:'synthetic-hh-sam@example.test',created_at:stamp}
 const upload=async(n,count)=>{
  const records=[{user:staff}]
  for(let i=0;i<count;i++){
   const id=n+i
   records.push({user:{id,role:'end-user',name:`Synthetic customer ${id}`,email:`synthetic-hh-${id}@example.test`,created_at:stamp}})
   records.push({ticket:{id:id+100000,requester_id:id,subject:`Synthetic history ${id}`,status:'open',created_at:stamp,updated_at:stamp,via:{channel:'email'},comments:[{id:id+200000,author_id:staff.id,public:true,body:'Synthetic staff reply',created_at:stamp}]}})
  }
  const filename=`synthetic-hh-undo-${n}.jsonl`
  await page.goto(origin+base+'/move-in')
  await page.getByLabel('Export file',{exact:true}).setInputFiles({name:filename,mimeType:'application/octet-stream',buffer:Buffer.from(records.map(JSON.stringify).join('\n'))})
  const uploaded=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().includes('/imports?'))
  await page.getByRole('button',{name:'Upload and review',exact:true}).click()
  const run=(await (await uploaded).json()).data
  await page.getByRole('heading',{name:`Ready for review: ${filename}`,exact:true}).waitFor({timeout:120000})
  await page.getByRole('button',{name:'Approve and import',exact:true}).click()
  await page.getByRole('heading',{name:`Complete: ${filename}`,exact:true}).waitFor({timeout:120000})
  return {id:run.id,filename,n,count,path:`/api/move-in/projects/${project}/imports/${run.id}`}
 }
 const undo=async run=>{
  const sent=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith(`/${run.id}/undo`))
  await page.getByRole('button',{name:'Undo whole import',exact:true}).click()
  return (await (await sent).json()).data.report
 }
 // Creating a native account for a historical author alone never edits the
 // imported history. A staff match must not become a blanket undo refusal.
 const staffRun=await upload(7100,1)
 const invitation=(await call(api+'/agents',{email:staff.email,role:'operator'})).data
 const accepted=await fetch(origin+'/api/identity/accept-token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:new URL(invitation.invitationUrl).searchParams.get('token'),name:staff.name,password:'synthetic-hh-staff-password'})})
 assert.equal(accepted.status,200)
 await undo(staffRun)
 await page.getByRole('heading',{name:`Undone: ${staffRun.filename}`,exact:true}).waitFor({timeout:120000})
 const agents=(await call(api+'/agents')).data
 assert.ok(agents.some(a=>a.name===staff.name&&!a.pending),'native staff survives undo')
 // A native edit alone exercises strict reversal, independently of references.
 const edited=await upload(7200,1)
 let contacts=(await call(api+'/contacts?search=synthetic-hh-7200&sort=name&direction=asc')).data
 const contact=contacts.find(c=>c.email==='synthetic-hh-7200@example.test');assert.ok(contact)
 await page.goto(origin+base+'/contacts/'+contact.id)
 const changedName='Synthetic customer with later native work'
 await page.getByLabel('Provided name',{exact:true}).fill(changedName)
 await page.getByRole('button',{name:'Save',exact:true}).click()
 await page.getByRole('status').filter({hasText:'Saved'}).waitFor()
 await page.goto(origin+base+'/move-in')
 await page.getByRole('button',{name:`${edited.filename} — Complete`,exact:true}).click()
 await undo(edited)
 await page.waitForFunction(async path=>{const r=await fetch(path);const {data}=await r.json();return data.error==='NATIVE_EDIT_CONFLICT'},edited.path,{timeout:120000})
 await page.reload()
 await page.getByRole('button',{name:`${edited.filename} — Undoing import`,exact:true}).click()
 await page.getByRole('alert').filter({hasText:changedName}).waitFor()
 const editReport=(await call(edited.path)).data.report
 assert.ok(editReport.undoConflicts.records.some(r=>r.name===changedName&&r.reason==='changed'))
 assert.equal(JSON.parse((await call(api+'/contacts/'+contact.id)).data.metadata_json).provided_name,changedName)
 // More than one diagnostic window and more than twenty conflicts: the last
 // contact is used by a new native conversation, the others have native edits.
 const referenced=await upload(7300,22)
 contacts=(await call(api+'/contacts?search=synthetic-hh-73&sort=name&direction=asc')).data
 const imported=contacts.filter(c=>/^synthetic-hh-73[0-9]{2}@example.test$/.test(c.email))
 assert.equal(imported.length,referenced.count)
 for(const c of imported.slice(0,-1))await call(api+'/contacts/'+c.id,{name:c.name+' edited natively'},'PUT')
 const held=imported.at(-1)
 const native=await call('/api/conversations',{projectId:project,contactId:held.id})
 const initial=await undo(referenced)
 await page.waitForFunction(async path=>{const r=await fetch(path);const {data}=await r.json();return data.error==='NATIVE_EDIT_CONFLICT'},referenced.path,{timeout:120000})
 await page.reload();await page.getByRole('button',{name:`${referenced.filename} — Undoing import`,exact:true}).click()
 const stopped=(await call(referenced.path)).data,report=stopped.report
 assert.equal(report.checkpoint,0,'later reference stops undo before removing children')
 assert.equal(report.total,initial.total);assert.equal(report.retained,report.total)
 assert.equal(report.undoConflicts.total,imported.length)
 assert.equal(report.undoConflicts.records.length,20)
 const alert=page.getByRole('alert').filter({hasText:'Undo stopped'})
 for(const record of report.undoConflicts.records)assert.ok((await alert.innerText()).includes(record.name))
 assert.ok((await alert.innerText()).includes(String(imported.length-report.undoConflicts.records.length)))
 assert.equal((await call(api+'/contacts/'+held.id)).data.id,held.id)
 assert.equal((await call(`/api/dashboard/projects/${project}/conversations/${native.id}`)).data.id,native.id)
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:900})
  await page.getByRole('heading',{name:`Undoing import: ${referenced.filename}`,exact:true}).scrollIntoViewIfNeeded()
  await page.screenshot({path:shot(`undo-conflicts-${width}.png`),fullPage:true})
 }
 await page.setViewportSize({width:1440,height:1000})
 return {staffMatch:'undo completed; native staff retained',nativeEdit:editReport,reference:report}
}
