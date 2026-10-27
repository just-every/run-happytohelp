import assert from 'node:assert/strict'
import {suppliedFreshdesk,publicBytes,privateBytes} from './supplied-attachments.mjs'
export async function attachmentBrowserFlow({page,origin,base,inspect}){
 for(const width of [1440,390]){
  const name=`supplied-attachments-${width}.jsonl`,records=suppliedFreshdesk(width+5001),source=records.map(JSON.stringify).join('\n')
  await page.setViewportSize({width,height:1000});await page.goto(origin+base+'/move-in');await page.getByLabel('Export format',{exact:true}).selectOption('freshdesk');await page.getByLabel('Export file',{exact:true}).setInputFiles({name,mimeType:'application/octet-stream',buffer:Buffer.from(source)});await page.getByRole('button',{name:'Upload and review',exact:true}).click()
  await page.getByRole('heading',{name:`Ready for review: ${name}`,exact:true}).waitFor({timeout:120000});const disclosure=page.getByText('Supplied attachments (2)',{exact:true});await disclosure.click();if(width===390)assert.ok((await disclosure.boundingBox()).height>=44,'attachment disclosure touch target');await page.getByText(/public-receipt\.txt — public message/).waitFor();await page.getByText(/private-triage\.txt — private note/).waitFor();await inspect(`attachments-review-${width}`)
  await page.getByRole('button',{name:'Approve and import',exact:true}).click();await page.getByRole('heading',{name:`Complete: ${name}`,exact:true}).waitFor({timeout:120000});await inspect(`attachments-report-${width}`)
  await page.getByRole('link',{name:/^Open conversation /}).first().click();await page.getByText('Where is my refund?',{exact:true}).waitFor();
  for(const [filename,expected] of [['public-receipt.txt',publicBytes],['private-triage.txt',privateBytes]]){const link=page.getByRole('link',{name:filename,exact:true});await link.waitFor();if(width===390){const target=await link.boundingBox();assert.ok(target.width>=44&&target.height>=44,'attachment touch target')}if(width===1440){const response=await page.request.get(new URL(await link.getAttribute('href'),origin).href);assert.equal(response.status(),200);assert.deepEqual(await response.body(),expected)}}
  await inspect(`attachments-native-${width}`)
  await page.goto(origin+base+'/move-in');await page.getByRole('button',{name:`${name} — Complete`,exact:true}).click();await page.getByRole('button',{name:'Undo whole import',exact:true}).click();await page.getByRole('heading',{name:`Undone: ${name}`,exact:true}).waitFor({timeout:120000})
 }
}
