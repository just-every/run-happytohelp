import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const root=resolve('.rer/site'),packet=resolve('../packet');
const mime={'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png'};
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;const file=resolve(root,'.'+(path==='/'?'/index.html':extname(path)?path:path+'.html'));if(!file.startsWith(root+'/'))throw Error();const data=await readFile(file);res.writeHead(200,{'Content-Type':mime[extname(file)]??'application/octet-stream'});res.end(data);}catch{res.writeHead(404);res.end('Not Found');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
let browser;const rows=[];
try{
 browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
 const context=await browser.newContext(),page=await context.newPage();
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:900});
  const response=await page.goto(origin+'/docs');await page.evaluate(()=>document.fonts.ready);
  const install=page.getByRole('link',{name:'install and run guide',exact:true});
  const run=page.getByRole('link',{name:'Run HappyToHelp page',exact:true});
  const row={width,status:response.status(),install:await install.getAttribute('href'),run:await run.getAttribute('href')};
  if(width===1440){assert.equal(response.status(),200);assert.equal(row.install,'/docs/install');assert.equal(row.run,'https://happytohelp.com/run');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
  for(const [id,name] of [['run-it-on-your-computer','run'],['deploy-to-your-own-cloudflare-account','deploy']]){
   await page.evaluate(()=>scrollTo(0,0));
   const clip=await page.locator('#'+id).evaluate(node=>{
    let next=node.nextElementSibling;while(next&&next.tagName!=='H2')next=next.nextElementSibling;
    const y=Math.max(0,Math.floor(node.getBoundingClientRect().top+scrollY-16));
    const bottom=next?next.getBoundingClientRect().top+scrollY:document.documentElement.scrollHeight;
    return {x:0,y,width:innerWidth,height:Math.ceil(bottom-y)};
   });
   await page.screenshot({path:packet+`/readme-${name}-${width}.png`,clip,fullPage:true,captureBeyondViewport:true});
  }
  rows.push(row);
 }
 await page.setViewportSize({width:1440,height:900});await page.goto(origin+'/docs');
 await page.getByRole('link',{name:'install and run guide',exact:true}).click();
 assert.equal(new URL(page.url()).pathname,'/docs/install');
 await page.getByRole('heading',{level:1,name:'Install HappyToHelp',exact:true}).waitFor();
 rows.push({guideClick:'passed',destination:'/docs/install'});
 await context.close();
 await import('node:fs/promises').then(fs=>fs.writeFile(packet+'/browser-proof.json',JSON.stringify({source:'.rer/site emitted by rer build --site',browser:'system Chromium, headless',assertionWidth:1440,visualWidths:[1440,390],rows},null,2)+'\n'));
 console.log(JSON.stringify(rows));
}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
