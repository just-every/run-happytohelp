import assert from 'node:assert/strict'
import {zendeskCorpus,publicBytes,privateBytes} from './zendesk-offline-fixture.mjs'

// Extends the existing desktop owner journey. The same state is captured at
// desktop and phone widths; functional assertions run at 1440.
export async function zendeskOfflineBrowserFlow({page,origin,base,inspect,request,project,token}){
 const originalProject=project,originalBase=base
 const isolated=await request('/api/management/projects',{token,body:{name:'synthetic-hh-offline',allowedOrigin:origin}})
 const switched=await page.request.post(origin+'/api/identity/switch-project',{data:{projectId:isolated.id}});assert.equal(switched.status(),200)
 project=isolated.id;base=`/projects/${project}`;token=(await switched.json()).token
 const records=await zendeskCorpus(),body=records.map(JSON.stringify).join('\n'),name='synthetic-hh-offline.ndjson'
 const capture=async state=>{for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await inspect(`zendesk-offline-${state}-${width}`)}await page.setViewportSize({width:1440,height:1000})}
 const upload=async(filename,source)=>{await page.goto(origin+base+'/move-in');await page.getByLabel('Export format',{exact:true}).selectOption('zendesk');await page.getByLabel('Export file',{exact:true}).setInputFiles({name:filename,mimeType:'application/octet-stream',buffer:Buffer.from(source)});await page.getByRole('button',{name:'Upload and review',exact:true}).click()}
 await page.goto(origin+base+'/move-in');await page.getByRole('link',{name:'Pack local ticket, user, organization, comment and history files with supplied attachments',exact:true}).waitFor();await capture('selection')
 await upload(name,body);await page.getByRole('heading',{name:`Ready for review: ${name}`,exact:true}).waitFor({timeout:120000})
 const contents=page.locator('summary').filter({hasText:'Ticket contents (6)'});await contents.focus();await page.keyboard.press('Enter');await page.getByText(/2 public comments, 1 internal notes, 1 tags, 1 typed fields/).waitFor()
 await page.getByText('Supplied attachments (2)',{exact:true}).click();await page.getByText('The conversation is incomplete.',{exact:false}).first().waitFor();await capture('review')
 await page.getByRole('button',{name:'Approve and import',exact:true}).click();await page.getByRole('heading',{name:`Complete: ${name}`,exact:true}).waitFor({timeout:120000});await capture('complete')
 await page.getByRole('link',{name:'Open conversation “synthetic-hh-1 new”',exact:true}).click()
 const details=page.getByRole('tab',{name:'Ticket',exact:true}),toggle=page.getByRole('button',{name:'Show conversation panel',exact:true});await details.or(toggle).first().waitFor();if(!await details.isVisible())await toggle.click();await details.click()
 const history=page.locator('summary').filter({hasText:'Imported status and SLA history'});await history.focus();await page.keyboard.press('Enter');await page.getByText('Metric file: supplied. Audit file: supplied. 5 events.',{exact:true}).waitFor()
 await page.getByText('Source elapsed units:',{exact:false}).waitFor();await page.getByText('synthetic-hh-unknown',{exact:false}).waitFor();await capture('ticket-history')
 const links=page.getByRole('link',{name:'receipt.txt',exact:true});await links.first().waitFor();assert.equal(await links.count(),2)
 const downloads=[];for(const link of await links.all()){const response=await page.request.get(new URL(await link.getAttribute('href'),origin).href);assert.equal(response.status(),200);downloads.push((await response.body()).toString('base64'))}
 assert.deepEqual(downloads.sort(),[publicBytes,privateBytes].map(b=>b.toString('base64')).sort())
 await page.reload();await details.or(toggle).first().waitFor();if(!await details.isVisible())await toggle.click();await details.click();await history.click();await page.getByText('Metric file: supplied. Audit file: supplied. 5 events.',{exact:true}).waitFor()
 await capture('ticket-reloaded')
 await upload(name,body);await page.getByText('This export was already processed.',{exact:false}).waitFor();await capture('repeat')
 await page.getByRole('button',{name:'Undo whole import',exact:true}).click();await page.getByRole('heading',{name:`Undone: ${name}`,exact:true}).waitFor({timeout:120000});await capture('undo')
 const eraseName='synthetic-hh-erase.ndjson';await upload(eraseName,body+'\n');await page.getByRole('heading',{name:`Ready for review: ${eraseName}`,exact:true}).waitFor({timeout:120000});await page.getByRole('button',{name:'Approve and import',exact:true}).click();await page.getByRole('heading',{name:`Complete: ${eraseName}`,exact:true}).waitFor({timeout:120000})
 const contacts=(await request(`/api/management/projects/${project}/contacts`,{token})).data,contact=contacts.find(c=>c.email==='synthetic-hh-1@example.test');assert.ok(contact)
 await request(`/api/management/projects/${project}/contacts/${contact.id}/erase`,{token,body:{}})
 await page.reload();await page.getByRole('button',{name:`${eraseName} — Source erased`,exact:true}).click();await page.getByText('Contact erasure removed this import’s source custody.',{exact:false}).waitFor();await capture('erased')
 await page.getByLabel('Export file',{exact:true}).setInputFiles({name:'synthetic-hh-replay.ndjson',mimeType:'application/octet-stream',buffer:Buffer.from(body+'\n\n')});await page.getByRole('button',{name:'Upload and review',exact:true}).click();await page.getByText(/This export contains erased identities/).waitFor();await capture('erasure-refusal')
 await page.request.post(origin+'/api/identity/switch-project',{data:{projectId:originalProject}});await page.goto(origin+originalBase+'/move-in')
}
