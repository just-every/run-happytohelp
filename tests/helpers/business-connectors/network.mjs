import {crmNetwork} from './crm-network.mjs';
import {shopifyNetwork} from './shopify-network.mjs';
export function createNetwork(){
 const calls=[],refunds=[],credits=[],activities=new Map();let failAfterWrite=false,subscriptionCancelled=false,subscriptionMetadata={},taxStatus='complete',balance=0,paused=null,currentPrice='synthetic-happytohelp-303';
 const json=value=>Response.json(value),customer='synthetic-happytohelp-201',payment='synthetic-happytohelp-202',subscription='synthetic-happytohelp-203';
 const writeShopify=value=>{if(failAfterWrite){failAfterWrite=false;throw Error('synthetic network timeout after provider commit');}return value;};
 const shopify=shopifyNetwork({customer,writeResult:writeShopify}),shopifyRefunds=shopify.refunds,crm=crmNetwork({customer,writeResult:writeShopify}),{notes,tasks}=crm;
 const handle=async request=>{
  const url=new URL(request.url),path=url.pathname,body=request.method==='GET'?null:await request.text(),data=body?(request.headers.get('content-type')?.includes('application/x-www-form-urlencoded')?Object.fromEntries(new URLSearchParams(body)):JSON.parse(body)):null;
  calls.push({host:url.hostname,path,method:request.method,data,headers:Object.fromEntries(request.headers)});
  const writeResult=value=>{if(failAfterWrite){failAfterWrite=false;throw Error('synthetic network timeout after provider commit');}return json(value);};
  if(url.hostname==='synthetic-happytohelp-1.myshopify.com')return json({data:await shopify.handle(url,data)});
  if(url.hostname==='api.stripe.com'){
   if(path==='/v1/account')return json({id:'synthetic-happytohelp-101'});
   if(path==='/v1/customers/'+customer)return json({id:customer,name:'Synthetic customer',currency:'usd',balance});
   if(path===`/v1/customers/${customer}/balance_transactions`){if(!data)return json({data:credits,has_more:false});const record={id:'synthetic-happytohelp-credit-'+credits.length,customer,amount:Number(data.amount),currency:'usd',ending_balance:balance+Number(data.amount),metadata:{h2h_action:data['metadata[h2h_action]']}};balance=record.ending_balance;credits.push(record);return writeResult(record);}
   if(path.startsWith(`/v1/customers/${customer}/balance_transactions/`))return json(credits.find(x=>x.id===path.split('/').pop()));
   if(path==='/v1/prices/synthetic-happytohelp-304')return json({id:'synthetic-happytohelp-304',active:true,currency:'usd',unit_amount:7500,recurring:{interval:'month',interval_count:1}});
   if(path==='/v1/invoices/upcoming')return json({customer,currency:'usd',amount_due:2500,total:2500,starting_balance:0,tax:0,total_tax_amounts:[],automatic_tax:{enabled:true,status:taxStatus},lines:{has_more:false,data:[{amount:2500,proration:true}]}});
   if(path==='/v1/invoices/synthetic-happytohelp-305')return json({id:'synthetic-happytohelp-305',customer,currency:'usd',paid:true,amount_paid:2500});
   if(path==='/v1/invoices')return json({has_more:false,data:[{id:'synthetic-happytohelp-204',customer,total:10000,tax:500,currency:'usd',status:'paid',payment_intent:payment}]});
   const sub=()=>({id:subscription,customer,status:'active',cancel_at_period_end:subscriptionCancelled,current_period_end:1795000000,metadata:subscriptionMetadata,pause_collection:paused,latest_invoice:'synthetic-happytohelp-305',items:{has_more:false,data:[{id:'synthetic-happytohelp-302',quantity:1,price:{id:currentPrice,currency:'usd',unit_amount:currentPrice==='synthetic-happytohelp-303'?5000:7500,recurring:{interval:'month',interval_count:1}}}]}});
   if(path==='/v1/subscriptions')return json({has_more:false,data:[sub()]});
   if(path==='/v1/subscriptions/'+subscription){if(data){if('cancel_at_period_end' in data)subscriptionCancelled=data.cancel_at_period_end==='true';if(data['pause_collection[behavior]'])paused={behavior:data['pause_collection[behavior]']};if(data['items[0][price]'])currentPrice=data['items[0][price]'];subscriptionMetadata={h2h_action:data['metadata[h2h_action]']};return writeResult(sub());}return json(sub());}
   if(path==='/v1/payment_intents/'+payment)return json({id:payment,customer,currency:'usd',status:'succeeded',amount_received:10000});
   if(path==='/v1/refunds'&&request.method==='GET')return json({has_more:false,data:refunds});
   if(path==='/v1/refunds'&&data){const existing=refunds.find(r=>r.metadata.h2h_action===data['metadata[h2h_action]']);if(existing)return json(existing);if(!request.headers.get('idempotency-key'))throw Error('Stripe requires idempotency');const result={id:'synthetic-happytohelp-refund-'+(refunds.length+1),payment_intent:data.payment_intent,amount:Number(data.amount),currency:'usd',status:'succeeded',metadata:{h2h_action:data['metadata[h2h_action]']}};refunds.push(result);return writeResult(result);}
   if(path.startsWith('/v1/refunds/'))return json(refunds.find(r=>r.id===path.split('/').pop()));
  }
  if(['api.hubapi.com','synthetic-happytohelp-1.my.salesforce.com'].includes(url.hostname)){const result=crm.handle(url,request,data);return result instanceof Response?result:json(result);}
  return new Response('Unavailable',{status:404});
 };
 return {handle,calls,refunds,credits,shopifyRefunds,shopify,crm,notes,tasks,activities,customer,payment,subscription,taxUnavailable(value){taxStatus=value?'failed':'complete';},timeoutAfterWrite(){failAfterWrite=true;},changeSource(){crm.changeSource();}};
}
export const accounts={shopify:{account:'101',host:'https://synthetic-happytohelp-1.myshopify.com'},stripe:{account:'synthetic-happytohelp-101'},hubspot:{account:'301'},salesforce:{account:'synthetic-happytohelp-501',host:'https://synthetic-happytohelp-1.my.salesforce.com'}};
const network=createNetwork();export default request=>network.handle(request);
