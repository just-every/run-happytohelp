import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,stat,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {devGate} from '/workspace/run-happytohelp/src/modules/operator-auth/dev-gate.mjs';
import {createAuthHandler} from '/workspace/run-happytohelp/src/modules/operator-auth/routes.mjs';
import {AuthError} from '/workspace/run-happytohelp/src/modules/operator-auth/errors.mjs';
const root='/workspace/run-happytohelp';
const packet=process.env.HOME+'/rer-consolidation/work/hh-rer-0219-adopt-1/packet';
const require=createRequire(root+'/package.json');
const {chromium}=require('playwright');
await mkdir(packet+'/browser',{recursive:true});
const brand={productName:'HappyToHelp',signInPath:'/signin',theme:'/rer-theme.css'};
const handler=createAuthHandler({presentation:brand,oneClick:{local:true,enter(){throw new AuthError('not_found',404)}}});
let gate,origin;
const server=createServer(async(req,res)=>{
 try {
  const url=new URL(req.url,origin);
  let response;
  if(url.pathname==='/__dev/key') response=await gate.exchange(new Request(url,{method:req.method,headers:req.headers}),brand,{invited:url.searchParams.get('invited')==='1'});
  else if(url.pathname==='/auth/one-click') response=await handler(new Request(url,{method:req.method,headers:req.headers}));
  else {
   const path=resolve(root+'/public','.'+url.pathname);
   if(path.startsWith(root+'/public/')&&(await stat(path).catch(()=>null))?.isFile()){
    const type={'.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml','.png':'image/png'}[extname(path)]??'application/octet-stream';
    response=new Response(await readFile(path),{headers:{'content-type':type}});
   } else response=new Response(null,{status:204});
  }
  res.writeHead(response.status,Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
 } catch {res.writeHead(500);res.end('Renderer fixture failed');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
origin='http://127.0.0.1:'+server.address().port;
gate=devGate({key:randomBytes(32).toString('base64url'),origin,local:true});
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
const cases=[
 {name:'gate-owner-only',path:'/__dev/key',status:200,heading:'This app runs on your own computer',invited:false},
 {name:'gate-invited',path:'/__dev/key?invited=1',status:200,heading:'This app runs on your own computer',invited:true},
 {name:'one-click-refused',path:'/auth/one-click',status:404,text:'This sign-in link did not open here. Open the link from the app itself, or run rer dev --as followed by the email address from the project folder.'}
];
const proofs=[];
try {
 for(const c of cases) for(const width of [1440,390]){
  const page=await browser.newPage({viewport:{width,height:width===1440?1000:844},deviceScaleFactor:1});
  try {
   const response=await page.goto(origin+c.path,{waitUntil:'networkidle'});
   await page.evaluate(()=>document.fonts.ready);
   if(width===1440){
    assert.equal(response.status(),c.status);
    if(c.heading){
     assert.equal(await page.locator('h1').innerText(),c.heading);
     const body=await page.locator('body').innerText();
     assert.equal(body.includes('To sign in as someone who was invited'),c.invited);
    } else assert.equal((await page.locator('body').innerText()).trim(),c.text);
   }
   const file='browser/'+c.name+'-'+width+'.png';
   await page.screenshot({path:packet+'/'+file,fullPage:true});
   proofs.push({screen:c.name,width,file,source:c.name==='one-click-refused'?'src/modules/operator-auth/routes.mjs':'src/modules/operator-auth/dev-gate.mjs',asserted:width===1440});
  } finally {await page.close();}
 }
 const receipt={at:new Date().toISOString(),head:execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),browser:'/usr/bin/chromium',args:['--no-sandbox'],boundary:'Browser render proof of copied upstream handler outputs using test-only inputs and the unchanged seed theme. The one-click error is injected by a fixture account adapter. No native workspace, live owner entry, provider or hosted installation is exercised. Assertions run at 1440 only; 390 is separate visual proof.',proofs,exit:0};
 await writeFile(packet+'/browser-proof-receipt.json',JSON.stringify(receipt,null,2)+'\n');
 console.log('Browser proof passed; six actual handler screenshots at 1440 and 390; assertions at 1440 only.');
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
