import {createServer} from 'node:http';
import {writeFile} from 'node:fs/promises';
import {build} from '/workspace/run-happytohelp/node_modules/esbuild/lib/main.js';
import {chromium} from '/workspace/run-happytohelp/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
const bundled=await build({entryPoints:['src/platform/document-recovery-script.ts'],bundle:true,write:false,format:'esm',platform:'node',loader:{'.css':'empty'},logLevel:'silent'});
const {documentRecoveryScript,documentEndMarker}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const packet=process.env.HH_PACKET;
const counts=new Map(),health=[];
const server=createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/health'){health.push(503);res.writeHead(503,{'Content-Type':'application/json'});res.end('{"status":"degraded"}');return;}
 if(url.pathname.startsWith('/interrupted/')){
  const count=(counts.get(url.pathname)||0)+1;counts.set(url.pathname,count);
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
  if(count===1){res.write('<!doctype html><html><head><title>Recovery transport fixture</title><script>'+documentRecoveryScript+'</script>');return;}
  res.end('<!doctype html><html><head><title>Recovered</title></head><body><h1>Recovered workspace document</h1>'+documentEndMarker+'</body></html>');return;
 }
 res.writeHead(404);res.end();
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox','--use-mock-keychain','--password-store=basic']});
const rows=[];
try{
 for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),path='/interrupted/'+width;
  await page.goto(origin+path,{waitUntil:'commit'});
  await page.getByRole('status').waitFor();
  const copy=await page.getByRole('status').innerText();
  await page.screenshot({path:`${packet}/recovery-${width}-waiting.png`,fullPage:true});
  await page.getByRole('heading',{name:'Recovered workspace document',exact:true}).waitFor({timeout:15000});
  assert.equal(counts.get(path),2,'a reachable degraded Worker permits exactly one document reload');
  await page.waitForTimeout(1000);
  assert.equal(counts.get(path),2,'a completed document is not reloaded again');
  rows.push({width,documentRequests:counts.get(path),healthStatuses:[...health],waitingCopy:copy,recovered:true});
  await context.close();
 }
 await writeFile(`${packet}/recovery-probe.json`,JSON.stringify({scenario:'Interrupted native document, reachable HTTP 503 health endpoint, completed retry',rows},null,2)+'\n');
 console.log(JSON.stringify(rows));
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
