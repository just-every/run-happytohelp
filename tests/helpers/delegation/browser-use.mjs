import assert from 'node:assert/strict'
import {mkdtemp} from 'node:fs/promises'
import {hero} from '../hero/flow.mjs'


// A paired connector resolves a visitor's request, then the person reviews its proposed reply with Use and presses Send.
async function heroAtWidth({runtime,browser,shot,viewport}){
 const tenant=await runtime.seedTenant({name:'Hero '+viewport.width,email:`owner-${viewport.width}@hero.test`,allowedOrigin:runtime.origin})
 // The visitor writes before the operator opens the dashboard and the team answers anyway, so presence-based away is off.
 await runtime.presenceAwayOff(tenant.projectId)
 const context=await browser.newContext({viewport}),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message))
 try{
  await context.addCookies([{name:'h2h_session',value:tenant.token,url:runtime.origin}])
  const widgetKey=(await (await context.request.get(runtime.origin+`/api/identity/projects/${tenant.projectId}`)).json()).widget_key
  const article={slug:'contact-your-support-team',title:'Contact your support team',content:'Open the website chat widget, type your question, and press Send. The support team can reply in the same conversation.',summary:'Contact the support team.',status:'draft'}
  const created=await context.request.post(runtime.origin+`/api/knowledge/${tenant.projectId}/articles`,{data:article});assert.equal(created.status(),201);article.id=(await created.json()).id
  const directory=await mkdtemp(shot(`hero-${viewport.width}-`))
  await hero({browser,operator:{context,page,cookie:`h2h_session=${tenant.token}`},origin:runtime.origin,bootstrap:{projectId:tenant.projectId,userId:tenant.userId,widgetKey,article},directory,viewport})
  assert.deepEqual(errors,[])
 }finally{await context.close()}
}

export async function useBrowserJourney({runtime,browser,shot}){
 await heroAtWidth({runtime,browser,shot,viewport:{width:1440,height:900}})
}
