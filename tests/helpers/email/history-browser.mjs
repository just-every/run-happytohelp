import assert from 'node:assert/strict'
import {evidence,auditPage} from '../../journeys/kit/browser.mjs'

/** Extends the existing email setup journey at 1440. The 390 captures are
 * inspection proof of these same controls, without another assertion run. */
export async function mailboxHistoryBrowser({runtime,page,owner}){
 const save=await evidence('mailbox-history'),errors=[]
 const onError=error=>errors.push(error.message);page.on('pageerror',onError)
 try{
  await page.goto(`${runtime.origin}/projects/${owner.projectId}/email-settings`)
  await page.getByRole('button',{name:'Add mailbox',exact:true}).click()
  for(const provider of ['gmail','microsoft','imap']){
   await page.getByLabel('Connection',{exact:true}).selectOption(provider)
   await page.getByLabel('Mode',{exact:true}).selectOption('history')
   assert.equal(await page.getByLabel('SMTP host',{exact:true}).count(),0,'read-only connection asks for no sending host')
   assert.equal(await page.getByLabel('SMTP password (if different)',{exact:true}).count(),0,'read-only connection asks for no sending credential')
   if(provider==='imap'){assert.equal(await page.getByLabel('IMAP password',{exact:true}).count(),1);await auditPage(page,save('editor-1440.png'))}
  }
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:save('editor-390.png'),fullPage:true});await page.setViewportSize({width:1440,height:900})
  await page.getByRole('button',{name:'Cancel',exact:true}).click()
  const quote=value=>"'"+String(value).replaceAll("'","''")+"'"
  const key=await crypto.subtle.importKey('raw',Buffer.alloc(32,7),'AES-GCM',false,['encrypt']),iv=crypto.getRandomValues(new Uint8Array(12)),cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:Buffer.from(`${owner.projectId}:mailbox:synthetic-happytohelp-history-browser`)},key,Buffer.from(JSON.stringify({mode:'history',accessToken:'synthetic-happytohelp-history',refreshToken:'synthetic-happytohelp-history',expiresAt:Date.now()+3600000}))),credential=Buffer.from(iv).toString('base64')+'.'+Buffer.from(cipher).toString('base64')
  await runtime.execute(`INSERT INTO mailbox_connections(id,project_id,provider,address,display_name,status,connected_by,created_at,updated_at,credential_cipher,cursor_json) VALUES('synthetic-happytohelp-history-browser',${quote(owner.projectId)},'gmail','synthetic-happytohelp-history@example.test','Synthetic history','connected',${quote(owner.userId)},${Date.now()},${Date.now()},${quote(credential)},'{"mode":"history"}')`)
  await page.reload();await page.getByRole('button',{name:'Synthetic history'}).click()
  assert.equal(await page.getByRole('button',{name:'Sync now',exact:true}).count(),0,'history has no live sync door')
  assert.equal(await page.getByRole('button',{name:'Save sender identity',exact:true}).count(),0,'history has no sending configuration')
  await page.getByRole('button',{name:'Choose folders',exact:true}).click();await page.getByLabel('Archive',{exact:true}).check()
  await auditPage(page,save('folders-1440.png'));await page.setViewportSize({width:390,height:844});await page.screenshot({path:save('folders-390.png'),fullPage:true});await page.setViewportSize({width:1440,height:900})
  await page.getByRole('button',{name:'Review history',exact:true}).click();await page.getByRole('link',{name:'Move in',exact:true}).click()
  await page.getByRole('button',{name:'Approve and import',exact:true}).waitFor({timeout:90000})
  await auditPage(page,save('review-1440.png'));await page.setViewportSize({width:390,height:844});await page.screenshot({path:save('review-390.png'),fullPage:true});await page.setViewportSize({width:1440,height:900})
  await page.goto(`${runtime.origin}/projects/${owner.projectId}/email-settings`);await page.getByRole('button',{name:'Synthetic history'}).click()
  await page.locator('summary').filter({hasText:'Turn on live mail'}).click()
  await auditPage(page,save('history-1440.png'))
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:save('history-390.png'),fullPage:true});await page.setViewportSize({width:1440,height:900})
  await page.getByRole('button',{name:'Turn on live mail',exact:true}).click();await page.getByRole('dialog').waitFor()
  await auditPage(page,save('live-step-1440.png'))
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:save('live-step-390.png'),fullPage:true});await page.setViewportSize({width:1440,height:900})
  assert.deepEqual(errors,[])
 }finally{page.off('pageerror',onError)}
}
