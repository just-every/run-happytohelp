import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {createRuntime} from './repo/tests/helpers/emitted-runtime.mjs'
import {undoBrowser} from './repo/tests/move-in/undo-browser.mjs'
import {generate} from './repo/tests/move-in/generator.mjs'
import {launchBrowser} from './repo/tests/journeys/kit/browser.mjs'
const phase=process.argv[2],out=new URL(`./packet/${phase}-move-in/`,import.meta.url).pathname
await mkdir(out,{recursive:true})
const runtime=await createRuntime({queueConsumers:true,...(process.env.H2H_PROOF_PERSIST?{persist:process.env.H2H_PROOF_PERSIST}:{})}),browser=await launchBrowser();let success=false
try{
 const call=async(path,body,method=body===undefined?'GET':'POST',token)=>{
  const response=await fetch(runtime.origin+path,{method,headers:{...(token?{Authorization:`Bearer ${token}`} :{}),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)})
  const data=await response.json();assert.ok(response.ok,`${method} ${path}: ${response.status} ${JSON.stringify(data)}`);return data
 }
 const owner={email:'synthetic-hh-proof@example.test',password:'synthetic-hh-proof-password-1'}
 let project,token
 if(process.env.H2H_PROOF_PERSIST){
  const login=await call('/api/identity/login',owner)
  const created=await call('/api/management/projects',{name:'Synthetic copy proof retry',allowedOrigin:runtime.origin},'POST',login.token)
  project=created.id;token=(await call('/api/identity/switch-project',{projectId:project},'POST',login.token)).token
 }else{
  const setup=await call('/api/identity/bootstrap',{...owner,name:'Synthetic import owner',allowedOrigin:runtime.origin})
  project=setup.projectId;token=(await call('/api/identity/login',owner)).token
 }
 const context=await browser.newContext({viewport:{width:1440,height:1000}})
 await context.addCookies([{name:'h2h_session',value:token,url:runtime.origin}])
 const page=await context.newPage();page.setDefaultTimeout(30000)
 await page.goto(`${runtime.origin}/projects/${project}/move-in`)
 const source=Array.from({length:11},(_,i)=>({user:{id:i+1,role:'end-user',name:`Synthetic customer ${i+1}`,email:`synthetic-hh-import-${i+1}@example.test`,created_at:'2024-01-01T00:00:00Z'}})).map(x=>JSON.stringify(x)).join('\n')
 const filename='synthetic-hh-copy-proof.jsonl'
 await page.getByLabel('Export format',{exact:true}).selectOption('zendesk')
 await page.getByLabel('Export file',{exact:true}).setInputFiles({name:filename,mimeType:'application/octet-stream',buffer:Buffer.from(source)})
 await page.getByRole('button',{name:'Upload and review',exact:true}).click()
 await page.getByRole('heading',{name:`Ready for review: ${filename}`,exact:true}).waitFor({timeout:120000})
 await page.getByRole('button',{name:'Approve and import',exact:true}).click()
 await page.getByRole('heading',{name:`Complete: ${filename}`,exact:true}).waitFor({timeout:120000})
 const contact=page.getByRole('link',{name:/^Open contact /}).first();const id=(await contact.getAttribute('href')).split('/').pop()
 await call(`/api/dashboard/projects/${project}/contacts/${id}`,{name:'Synthetic later native edit'},'PUT',token)
 await page.getByRole('button',{name:'Undo whole import',exact:true}).click()
 await page.getByRole('alert').filter({hasText:'Remaining imported changes are kept.'}).waitFor({timeout:120000})
 const section=page.getByRole('heading',{name:`Undoing import: ${filename}`,exact:true}).locator('../..')
 const status=await section.getByRole('status').first().innerText()
 const summary=page.locator('summary').filter({hasText:'Original import review'});await summary.click()
 const reviewCount=await page.getByText('Original import review',{exact:true}).count()
 assert.match(status,/1 of 11 imported changes reversed/)
 if(phase==='after'){
  assert.match(status,/1 record removed, 0 prior records restored/)
  assert.equal(reviewCount,1)
 }
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:width===390?844:1000});await section.scrollIntoViewIfNeeded();await page.screenshot({path:out+`stopped-undo-expanded-${width}.png`,fullPage:true})
 }
 const runs=await call(`/api/move-in/projects/${project}/imports`,undefined,'GET',token)
 await writeFile(out+'receipt.json',JSON.stringify({phase,status,originalReviewLabelCount:reviewCount,run:runs.data.map(r=>({state:r.state,error:r.error,report:r.report})),screenshots:[1440,390].map(w=>`stopped-undo-expanded-${w}.png`)},null,2)+'\n')
 console.log(JSON.stringify({phase,status,reviewCount}));
 if(phase==='after'){
  const docs=[]
  for(const slug of ['operations','changelog']){
   await page.goto(`${runtime.origin}/docs/${slug}`)
   const text=await page.locator('body').innerText()
   assert.ok(text.length>1000,'published documentation renders its content')
   assert.ok(!text.includes('Run Edit Run fleet'),'published documentation has no agent signature')
   docs.push({path:`/docs/${slug}`,renderedCharacters:text.length,agentSignatures:0})
  }
  await writeFile(out+'published-docs-receipt.json',JSON.stringify(docs,null,2)+'\n')
  await page.setViewportSize({width:1440,height:1000})
  await page.goto(`${runtime.origin}/projects/${project}/move-in`)
  const whole='synthetic-hh-whole-undo.jsonl'
  await page.getByLabel('Export format',{exact:true}).selectOption('zendesk')
  const content=generate('zendesk',6,1440)
  await page.getByLabel('Export file',{exact:true}).setInputFiles({name:whole,mimeType:'application/octet-stream',buffer:Buffer.from(content)})
  await page.getByRole('button',{name:'Upload and review',exact:true}).click()
  await page.getByRole('heading',{name:`Ready for review: ${whole}`,exact:true}).waitFor({timeout:120000})
  await page.getByRole('button',{name:'Approve and import',exact:true}).click()
  await page.getByRole('heading',{name:`Complete: ${whole}`,exact:true}).waitFor({timeout:120000})
  const result=await undoBrowser({page,filename:whole,shot:name=>out+name})
  await writeFile(out+'whole-undo-receipt.json',JSON.stringify(result,null,2)+'\n')
  console.log('PASS existing undoBrowser',JSON.stringify(result))
 }
 success=true
}finally{await browser.close();await runtime.close(success)}
