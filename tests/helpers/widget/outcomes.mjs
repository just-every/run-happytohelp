import {createServer} from 'node:http'
import {readFile} from 'node:fs/promises'
import {startApp} from '../../journeys/kit/app.mjs'
import {launchBrowser,viewports} from '../../journeys/kit/browser.mjs'
import {openaiStream} from '../openai-stream.mjs'
import {availabilityOutcomes} from './outcomes-availability.mjs'
import {campaignOutcomes} from './outcomes-campaigns.mjs'
import {campaignLimits} from './outcomes-limits.mjs'

// An independent checkout page installs the shipped widget. All API, socket,
// queue and persistence behavior is native; only mail/model HTTPS edges answer fixtures.
export async function outcomesJourney(){
 const widget=await readFile('public/widget.js'),mail=[]
 const site=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/widget.js'?'application/javascript':'text/html');res.end(req.url==='/widget.js'?widget:'<!doctype html><html lang="en"><meta charset="utf-8"><title>Checkout</title><body><h1>Checkout</h1><p>Your order is ready.</p></body></html>')})
 await new Promise(resolve=>site.listen(0,'127.0.0.1',resolve))
 const website=`http://127.0.0.1:${site.address().port}`
 const app=await startApp({listen:true,captureQueue:true,bindings:{H2H_LOCAL:'true',H2H_WORKFLOW_NOW:String(Date.parse('2026-10-26T22:00:00Z')),APP_ORIGIN:'https://app.example',EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'synthetic-widget-mail',EMAIL_FROM:'Support <support@example.test>'},outbound:async request=>{
  if(new URL(request.url).hostname==='api.resend.com'){mail.push(await request.json());return Response.json({id:`mail-${mail.length}`})}
  if(new URL(request.url).hostname==='api.openai.com')return openaiStream('Your checkout is saved. A teammate can help you finish.',{input_tokens:5,output_tokens:12})
  throw Error('Unexpected provider edge: '+new URL(request.url).hostname)
 }})
 const browser=await launchBrowser()
 try{
  const w=await app.seedWorkspace('widget-outcomes',{allowedOrigin:website}),p=w.projectId,owner=w.tokens.owner
  const manage=`/api/management/projects/${p}`,headers={Origin:website}
  const ok=(path,body,method=body===undefined?'GET':'PUT')=>app.ok(path,{token:owner,body,method})
  const settings=body=>ok(manage+'/settings',body)
  const availability=body=>ok(manage+'/availability',body)
  const configuration=async()=>(await app.call(`/api/widget/settings?widgetKey=${w.widgetKey}`,{headers,status:200})).data
  const clock=at=>app.configure({H2H_WORKFLOW_NOW:String(Date.parse(at))})
  const open=async({open=true,collector=false,consent=true,at=new Date().toISOString()}={})=>{
   const context=await browser.newContext({viewport:viewports.desktop,timezoneId:'Pacific/Honolulu'}),page=await context.newPage()
   page.setDefaultTimeout(15000)
   const apiRequests=[];page.on('request',request=>{if(request.url().startsWith(app.url+'/api/'))apiRequests.push(new URL(request.url()).pathname)})
   const requests=[];page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith('/widget-events')){const body=request.postDataJSON();requests.push(body)}})
   const errors=[];page.on('pageerror',error=>errors.push(error.message))
   await page.clock.install({time:new Date(at)})
   const init=async()=>{await page.addScriptTag({url:website+'/widget.js'});await page.evaluate(options=>window.h2h('init',options),{widgetKey:w.widgetKey,apiOrigin:app.url,open,settings:{await_consent:!consent,collector:{enabled:collector,disable_bots:false}}})}
   await page.goto(website+'/checkout');await init()
   const key=`rer-widget:${app.url}:${w.widgetKey}`
   const session=async()=>{await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key)||'null')?.conversationId,key);return page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key)}
   const reload=async()=>{await page.reload();await init()}
   return {context,page,session,reload,errors,requests,apiRequests,close:()=>context.close()}
  }
  const transcript=v=>app.ok(`/api/conversations/${v.conversationId}/messages`,{token:v.token,headers})
  const event=(v,action,data)=>app.ok(`/api/conversations/${v.conversationId}/widget-events`,{token:v.token,headers,body:{action,data}})
  const fixture={app,w,p,owner,manage,headers,ok,settings,availability,configuration,clock,open,transcript,event,mail}
  await availabilityOutcomes(fixture)
  await campaignLimits(fixture)
  await campaignOutcomes(fixture)
 }finally{await browser.close();await app.close();await new Promise(resolve=>site.close(resolve))}
}
