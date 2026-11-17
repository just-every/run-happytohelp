import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
const runtimeURL=new URL('./repo/tests/helpers/emitted-runtime.mjs',import.meta.url).href;
const browserURL=new URL('./repo/tests/journeys/kit/browser.mjs',import.meta.url).href;
globalThis.__hhMigratedState=process.env.HH_MIGRATED_STATE||undefined;
registerHooks({load(url,context,nextLoad){
 const result=nextLoad(url,context);
 if(url!==runtimeURL&&url!==browserURL)return result;
 let source=typeof result.source==='string'?result.source:Buffer.from(result.source).toString();
 if(url===runtimeURL){
  source="import {cp as copyState} from 'node:fs/promises';\n"+source.replace('export async function createRuntime(', 'async function createRuntimeNative(');
  source+=`
export async function createRuntime(options={}){
 let copied;
 if(globalThis.__hhMigratedState&&!options.persist){
  copied=await mkdtemp(join(tmpdir(),'hh-repeat-state-'));
  await copyState(globalThis.__hhMigratedState,copied,{recursive:true});
 }
 const runtime=await createRuntimeNative({...options,...(copied?{persist:copied}:{})});
 if(!globalThis.__hhMigratedState){
  const snapshot=await mkdtemp(join(tmpdir(),'hh-migrated-snapshot-'));
  await runtime.restart(()=>copyState(join(runtime.directory,'state'),snapshot,{recursive:true}));
  globalThis.__hhMigratedState=snapshot;
 }
 const close=runtime.close;
 runtime.close=async passed=>{
  await close(passed);
  if(copied&&passed)await rm(copied,{recursive:true,force:true});
 };
 return runtime;
}
`;
 }else{
  source="import {writeFile as writeReceipt} from 'node:fs/promises';\n"+source.replace('export const launchBrowser=', 'const baseLaunchBrowser=');
  source+=`
let contextNumber=0;
export const launchBrowser=async()=>{
 const browser=await baseLaunchBrowser(),newContext=browser.newContext.bind(browser);
 browser.newContext=async options=>{
  const context=await newContext(options),number=++contextNumber,events=[];
  const directory=process.env.HH_PROOF_DIRECTORY;
  await mkdir(directory,{recursive:true});
  await context.tracing.start({screenshots:true,snapshots:true,sources:true});
  const newPage=context.newPage.bind(context);
  context.newPage=async()=>{
   const page=await newPage(),session=await context.newCDPSession(page);
   await session.send('Emulation.setCPUThrottlingRate',{rate:6});
   await session.send('Network.emulateNetworkConditions',{offline:false,latency:250,downloadThroughput:750000,uploadThroughput:250000});
   page.on('response',response=>{
    const path=new URL(response.url()).pathname;
    if(path.includes('/procedures'))events.push({path:path.replace(/[a-f0-9-]{36}/g,'<id>'),status:response.status()});
   });
   page.on('pageerror',error=>events.push({error:error.message}));
   return page;
  };
  const close=context.close.bind(context);let closed=false;
  context.close=async()=>{
   if(closed)return;closed=true;
   await context.tracing.stop({path:directory+'/context-'+number+'.zip'});
   await writeReceipt(directory+'/context-'+number+'.json',JSON.stringify({context:number,cpuRate:6,networkLatencyMs:250,events},null,2)+'\\n');
   await close();
  };
  return context;
 };
 return browser;
};
`;
 }
 return {...result,source};
}});
