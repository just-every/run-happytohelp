import {writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const checkout=resolve(process.env.HH_CHECKOUT||'./repo');
const {createRuntime}=await import(pathToFileURL(checkout+'/tests/helpers/emitted-runtime.mjs'));
const {launchBrowser}=await import(pathToFileURL(checkout+'/tests/journeys/kit/browser.mjs'));
const {proceduresBrowserJourney}=await import(pathToFileURL(process.env.HH_HELPER||checkout+'/tests/helpers/ai/procedures-browser.mjs'));
const directory=resolve(process.env.HH_DIAGNOSTICS||'./diagnostics');await mkdir(directory,{recursive:true});
const runtime=await createRuntime({queueConsumers:true,vars:{APP_ORIGIN:'http://127.0.0.1',OPENAI_API_KEY:'synthetic-hh-1',TRAINING_PRICE_CEILINGS:JSON.stringify({'gpt-5.6-luna':{inputPerMillion:5,outputPerMillion:20}})},...(process.env.HH_PERSIST?{persist:process.env.HH_PERSIST}:{}),outboundFixture:pathToFileURL(checkout+'/tests/helpers/ai/suggestion-network.mjs').href});
const browser=await launchBrowser(),newContext=browser.newContext.bind(browser);
let iteration=0,events=[],failures=0;const fixtureRun=Date.now();
const seedTenant=runtime.seedTenant,execute=runtime.execute;
runtime.seedTenant=options=>seedTenant({...options,email:options.email.replace('@','-'+Date.now()+'-'+iteration+'@')});
runtime.execute=sql=>execute(sql.replaceAll('synthetic-hh-procedure-admin','synthetic-hh-procedure-admin-'+fixtureRun+'-'+iteration));
browser.newContext=async options=>{
 const context=await newContext(options);
 await context.tracing.start({screenshots:true,snapshots:true,sources:true});
 const newPage=context.newPage.bind(context);
 context.newPage=async()=>{
  const page=await newPage(),session=await context.newCDPSession(page);
  await session.send('Emulation.setCPUThrottlingRate',{rate:Number(process.env.HH_CPU_RATE||6)});
  if(process.env.HH_NETWORK_LATENCY)await session.send('Network.emulateNetworkConditions',{offline:false,latency:Number(process.env.HH_NETWORK_LATENCY),downloadThroughput:750000,uploadThroughput:250000});
  page.on('request',r=>{if(r.url().includes('/procedures'))events.push({at:Date.now(),type:'request',method:r.method(),path:new URL(r.url()).pathname.replace(/[a-f0-9-]{36}/g,'<id>')})});
  page.on('response',r=>{if(r.url().includes('/procedures'))events.push({at:Date.now(),type:'response',status:r.status(),path:new URL(r.url()).pathname.replace(/[a-f0-9-]{36}/g,'<id>')})});
  page.on('pageerror',e=>events.push({at:Date.now(),type:'error',message:e.message}));
  return page;
 };
 const close=context.close.bind(context);
 context.close=async()=>{
  for(const page of context.pages()){
   try{events.push({at:Date.now(),type:'last-state',text:await page.locator('.procedure-settings').count()?await page.locator('.procedure-settings').innerText():await page.locator('.workspace-page-content').innerText(),focus:await page.evaluate(()=>document.activeElement?.outerHTML)});}catch{}
  }
  await context.tracing.stop({path:directory+'/run-'+iteration+'.zip'});await close();
 };
 return context;
};
try{
 for(iteration=1;iteration<=Number(process.env.HH_RUNS||1);iteration++){
  events=[];const start=Date.now();let error;
  try{await proceduresBrowserJourney({runtime,browser,shot:file=>directory+'/'+iteration+'-'+file})}catch(e){error=e;failures++;}
  const receipt={iteration,passed:!error,durationMs:Date.now()-start,cpuRate:Number(process.env.HH_CPU_RATE||6),networkLatency:Number(process.env.HH_NETWORK_LATENCY||0),...(error?{error:{message:error.message,stack:error.stack}}:{}),events};
  await writeFile(directory+'/run-'+iteration+'.json',JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify({...receipt,events:undefined}));
  if(error&&process.env.HH_KEEP_GOING!=='1')break;
 }
}finally{await browser.close();await runtime.close(failures===0)}
process.exitCode=failures?1:0;
