import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {attachmentFixtures,publicBytes,privateBytes} from './attachment-fixtures.mjs'

export async function attachmentBrowser({page,origin,base,project,token,request,inspect,width}){
 const fixture=attachmentFixtures()[0],n=width*100,ticket=fixture.rows.find(row=>row.ticket).ticket
 for(const row of fixture.rows)if(row.user)row.user.id+=n
 ticket.id+=n;ticket.requester_id+=n;ticket.subject=`Replacement parcel ${width}`;ticket.reply_to=`helpdesk+historical-${ticket.id}@example.test`;delete ticket.group_id
 for(const comment of ticket.comments){comment.id+=n;comment.author_id+=n}
 for(const member of fixture.members){const parts=member.name.split('/');parts[1]=String(ticket.id);const parent=decodeURIComponent(parts[2]).split(':');parent[0]=String(Number(parent[0])+n);parts[2]=encodeURIComponent(parent.join(':'));member.name=parts.join('/')}
 const companyName=`Ridgeline Supply ${width}`,companyId=n+30,contact=fixture.rows.find(row=>row.user?.id===ticket.requester_id).user
 contact.email=`migration-${width}@example.test`;contact.organization_id=companyId
 fixture.rows.push({organization:{id:companyId,name:companyName,domain_names:['ridgeline.example'],shared_tickets:true,created_at:contact.created_at,updated_at:contact.created_at}})
 const name=`support-files-${width}.zip`
 await page.setViewportSize({width,height:1000});await page.goto(origin+base+'/move-in')
 await page.getByLabel('Export format',{exact:true}).selectOption('zendesk');await page.getByLabel('Export file',{exact:true}).setInputFiles({name,mimeType:'application/zip',buffer:fixture.archive()});await page.getByRole('button',{name:'Upload and review',exact:true}).click()
 await page.getByRole('heading',{name:`Ready for review: ${name}`,exact:true}).waitFor({timeout:120000});await inspect('attachment-review-'+width)
 await page.getByRole('button',{name:'Approve and import',exact:true}).click();await page.getByRole('heading',{name:`Complete: ${name}`,exact:true}).waitFor({timeout:120000});await inspect('attachment-report-'+width)
 const report=async()=>{await page.goto(origin+base+'/move-in');await page.getByRole('button',{name:`${name} — Complete`,exact:true}).click();await page.getByRole('heading',{name:`Complete: ${name}`,exact:true}).waitFor()}
 await page.getByRole('link',{name:`Review company “${companyName}”`,exact:true}).click();await page.getByRole('button',{name:companyName,exact:true}).click();await page.getByRole('heading',{name:companyName,exact:true}).waitFor();await page.getByText(contact.email,{exact:true}).first().waitFor();await inspect('imported-company-'+width)
 await report();const run=(await request(`/api/move-in/projects/${project}/imports`,{token})).data.find(row=>row.filename===name);const ownership=await request(`/api/move-in/projects/${project}/imports/${run.id}/ownership`,{token});assert.equal(ownership.total,1,JSON.stringify(ownership));await page.getByText('Review imported ownership',{exact:true}).click();const identity=await request('/api/identity/session',{token})
 try{await page.getByLabel('Source agent 77',{exact:true}).selectOption(identity.id)}catch(error){await page.screenshot({path:`test-results/move-in/ownership-failure-${width}.png`,fullPage:true});throw error};await page.getByRole('button',{name:'Preview assignments',exact:true}).click();await page.getByRole('button',{name:'Apply assignments',exact:true}).waitFor();await inspect('imported-ownership-preview-'+width)
 await page.getByRole('button',{name:'Apply assignments',exact:true}).click();await page.getByText('1 assignments applied. 0 remain to review.',{exact:true}).waitFor();await inspect('imported-ownership-applied-'+width)
 await page.getByRole('link',{name:/^Open conversation /}).click()
 for(const [filename,bytes] of [['parcel.bin',publicBytes],['inspection.txt',privateBytes]]){
  const link=page.getByRole('link',{name:filename,exact:true});await link.waitFor();await link.scrollIntoViewIfNeeded()
  const pending=page.waitForEvent('download');await link.click();const download=await pending;assert.deepEqual(await readFile(await download.path()),bytes)
 }
 await inspect('imported-attachment-history-'+width)
}
