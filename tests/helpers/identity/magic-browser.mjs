import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {auditPage,viewports} from '../../journeys/kit/browser.mjs'

export async function magicSignIn({runtime,browser,origin,tenant,shot}){
 const context=await browser.newContext({viewport:viewports.desktop}),page=await context.newPage()
 page.setDefaultTimeout(20000)
 await page.goto(origin+'/login')
 await page.getByRole('link',{name:'Email me a sign-in link',exact:true}).click()
 await page.getByLabel('Email',{exact:true}).fill('unknown@security.example.test')
 const requested=page.waitForResponse(r=>r.url().endsWith('/api/identity/magic-link')&&r.request().method()==='POST')
 await page.getByRole('button',{name:'Email me a sign-in link',exact:true}).click()
 assert.equal((await requested).status(),202)
 await page.getByRole('status').filter({hasText:'If this address belongs to a HappyToHelp account'}).waitFor()
 // Request the owner's actual invitation and read it at the fake mail edge.
 await page.getByLabel('Email',{exact:true}).fill('casey@lantern.test')
 const delivered=page.waitForResponse(r=>r.url().endsWith('/api/identity/magic-link')&&r.request().method()==='POST')
 await page.getByRole('button',{name:'Email me a sign-in link',exact:true}).click()
 assert.equal((await delivered).status(),202)
 let link;const deadline=Date.now()+10000
 while(!link&&Date.now()<deadline){
  const messages=await readFile(join(runtime.directory,'mail.jsonl'),'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error})
  const mail=messages.trim().split('\n').filter(Boolean).map(JSON.parse).find(message=>message.to.includes('casey@lantern.test')&&message.text.includes('/login/magic'))
  if(mail)link=mail.text.match(/https?:\/\/[^\s]+\/login\/magic[^\s]*/)[0]
  else await new Promise(done=>setTimeout(done,100))
 }
 assert.ok(link,'the owner receives the actual single-use sign-in link')
 assert.equal((await context.request.get(link)).status(),200)
 assert.equal((await context.request.get(origin+'/api/identity/session')).status(),401,'scanner GET creates no session')
 await page.goto(link)
 await page.getByRole('button',{name:'Sign in',exact:true}).waitFor()
 assert.equal((await context.request.get(origin+'/api/identity/session')).status(),401,'opening the link does not consume it')
 await page.getByRole('button',{name:'Sign in',exact:true}).click()
 await page.waitForURL(url=>url.pathname.startsWith('/projects/'+tenant.projectId+'/'))
 assert.equal((await context.request.get(origin+'/api/identity/session')).status(),200)
 await auditPage(page,shot('magic-signed-in.png'))
 const replay=await browser.newContext({viewport:viewports.desktop})
 try{
  const repeated=await replay.newPage();await repeated.goto(link)
  await repeated.getByRole('button',{name:'Sign in',exact:true}).click()
  await repeated.getByRole('alert').filter({hasText:'invalid, expired or already used'}).waitFor()
  assert.equal((await replay.request.get(origin+'/api/identity/session')).status(),401)
 }finally{await replay.close()}
 return page
}
