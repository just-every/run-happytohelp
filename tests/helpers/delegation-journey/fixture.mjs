import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';

// The customer system is a disposable loopback service, never application code.
export async function customerFixture(){
 let enabled=false,brokenPath=false;const events=[];
 const customerPath='/stores/synthetic-happytohelp-1/es';
 const server=createServer((req,res)=>{
  const event={id:randomUUID(),method:req.method,path:req.url,at:new Date().toISOString()};
  if(req.url==='/settings'&&req.method==='GET'){
   events.push({...event,enabled});res.setHeader('Content-Type','application/json');res.end(JSON.stringify({enabled,observationId:event.id}));
  }else if(req.url==='/enable'&&req.method==='POST'){
   enabled=true;events.push({...event,enabled});res.setHeader('Content-Type','application/json');res.end(JSON.stringify({enabled,changeId:event.id}));
  }else if(req.method==='GET'&&[customerPath,'/stores/synthetic-happytohelp-2/es'].includes(req.url)){
   const recovered=req.url!==customerPath||(enabled&&!brokenPath);
   const status=recovered?200:503;events.push({...event,status});res.statusCode=status;
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify({store:req.url.split('/')[2],locale:'es',available:recovered,observationId:event.id}));
  }else{res.statusCode=404;res.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {origin:`http://127.0.0.1:${server.address().port}`,events,customerPath,get enabled(){return enabled},failCustomerPath(){brokenPath=true},reset(){enabled=false;brokenPath=false;events.length=0},async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}};
}
