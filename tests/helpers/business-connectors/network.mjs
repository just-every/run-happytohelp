// Protocol fixtures exist only at fetch. Application routes, D1, approval, custody and browser rendering remain real.
export function createNetwork(){
 const calls=[],refunds=[],notes=new Map(),tasks=new Map(),activities=new Map();let failAfterWrite=false,stage='customer',revision='2026-10-23T12:00:00Z',subscriptionCancelled=false,subscriptionMetadata={};
 const json=value=>Response.json(value),customer='synthetic-happytohelp-201',payment='synthetic-happytohelp-202',subscription='synthetic-happytohelp-203';
 const handle=async request=>{
  const url=new URL(request.url),path=url.pathname,body=request.method==='GET'?null:await request.text(),data=body?(request.headers.get('content-type')?.includes('application/x-www-form-urlencoded')?Object.fromEntries(new URLSearchParams(body)):JSON.parse(body)):null;
  calls.push({host:url.hostname,path,method:request.method,data,headers:Object.fromEntries(request.headers)});
  const writeResult=value=>{if(failAfterWrite){failAfterWrite=false;throw Error('synthetic network timeout after provider commit');}return json(value);};
  if(url.hostname==='synthetic-happytohelp-1.myshopify.com'){
   if(data.query.includes('currentAppInstallation'))return json({data:{shop:{id:'gid://shopify/Shop/101',myshopifyDomain:url.hostname},currentAppInstallation:{accessScopes:[{handle:'read_orders'},{handle:'read_customers'}]}}});
   const source=data.variables?.id;if(source!=='gid://shopify/Customer/'+customer)return json({data:{customer:null}});
   return json({data:{customer:{id:source,displayName:'Synthetic customer',orders:{pageInfo:{hasNextPage:false},nodes:[{id:'gid://shopify/Order/901',name:'#901',displayFinancialStatus:'PAID',displayFulfillmentStatus:'FULFILLED',totalPriceSet:{shopMoney:{amount:'100.00',currencyCode:'USD'}},totalTaxSet:{shopMoney:{amount:'5.00',currencyCode:'USD'}},totalShippingPriceSet:{shopMoney:{amount:'10.00',currencyCode:'USD'}},totalRefundedSet:{shopMoney:{amount:'0.00',currencyCode:'USD'}},fulfillments:[{status:'SUCCESS',trackingInfo:[{company:'Synthetic delivery',number:'901'}]}],returns:{nodes:[]},refunds:[]}]}}}});
  }
  if(url.hostname==='api.stripe.com'){
   if(path==='/v1/account')return json({id:'synthetic-happytohelp-101'});
   if(path==='/v1/customers/'+customer)return json({id:customer,name:'Synthetic customer'});
   if(path==='/v1/invoices')return json({has_more:false,data:[{id:'synthetic-happytohelp-204',customer,total:10000,tax:500,currency:'usd',status:'paid',payment_intent:payment}]});
   const sub=()=>({id:subscription,customer,status:'active',cancel_at_period_end:subscriptionCancelled,current_period_end:1795000000,metadata:subscriptionMetadata});
   if(path==='/v1/subscriptions')return json({has_more:false,data:[sub()]});
   if(path==='/v1/subscriptions/'+subscription){if(data){subscriptionCancelled=data.cancel_at_period_end==='true';subscriptionMetadata={h2h_action:data['metadata[h2h_action]']};return writeResult(sub());}return json(sub());}
   if(path==='/v1/payment_intents/'+payment)return json({id:payment,customer,currency:'usd',status:'succeeded',amount_received:10000});
   if(path==='/v1/refunds'&&request.method==='GET')return json({has_more:false,data:refunds});
   if(path==='/v1/refunds'&&data){const existing=refunds.find(r=>r.metadata.h2h_action===data['metadata[h2h_action]']);if(existing)return json(existing);if(!request.headers.get('idempotency-key'))throw Error('Stripe requires idempotency');const result={id:'synthetic-happytohelp-refund-'+(refunds.length+1),payment_intent:data.payment_intent,amount:Number(data.amount),currency:'usd',status:'succeeded',metadata:{h2h_action:data['metadata[h2h_action]']}};refunds.push(result);return writeResult(result);}
   if(path.startsWith('/v1/refunds/'))return json(refunds.find(r=>r.id===path.split('/').pop()));
  }
  if(url.hostname==='api.hubapi.com'){
   if(path==='/account-info/v3/details')return json({portalId:301});
   if(path==='/crm/v3/objects/contacts/'+customer)return json({id:customer,updatedAt:revision,properties:{firstname:'Synthetic',lastname:'Customer',company:'Synthetic account',hubspot_owner_id:'801',lifecyclestage:stage}});
   if(path==='/crm/v3/objects/notes'&&data){const r={id:'synthetic-happytohelp-note-'+notes.size,properties:data.properties,associations:{contacts:{results:[{id:data.associations[0].to.id}]}}};notes.set(r.id,r);return writeResult(r);}
   if(path.startsWith('/crm/v3/objects/notes/'))return json(notes.get(path.split('/').pop()));
  }
  if(url.hostname==='synthetic-happytohelp-1.my.salesforce.com'){
   if(path==='/services/oauth2/userinfo')return json({organization_id:'synthetic-happytohelp-501'});
   if(path==='/services/data/v66.0/sobjects/Contact/'+customer)return json({Id:customer,Name:'Synthetic customer',AccountId:'801',OwnerId:'802',LastModifiedDate:revision});
   if(path==='/services/data/v66.0/sobjects/Task'&&data){const r={Id:'synthetic-happytohelp-task-'+tasks.size,...data};tasks.set(r.Id,r);return writeResult({id:r.Id,success:true});}
   if(path.startsWith('/services/data/v66.0/sobjects/Task/'))return json(tasks.get(path.split('/').pop()));
  }
  if(url.hostname==='app.orbit.love'){
   if(path==='/api/v1/synthetic-happytohelp-601')return json({data:{id:'601',attributes:{slug:'synthetic-happytohelp-601'}}});
   if(path==='/api/v1/synthetic-happytohelp-601/members/'+customer)return json({data:{id:customer,attributes:{name:'Synthetic customer',company:'Synthetic account',orbit_level:stage,updated_at:revision}}});
   if(path==='/api/v1/synthetic-happytohelp-601/activities'&&data){const r={id:'synthetic-happytohelp-activity-'+activities.size,attributes:data.activity};activities.set(r.id,r);return writeResult({data:r});}
   if(path.startsWith('/api/v1/synthetic-happytohelp-601/activities/'))return json({data:activities.get(path.split('/').pop())});
  }
  return new Response('Unavailable',{status:404});
 };
 return {handle,calls,refunds,notes,tasks,activities,customer,payment,subscription,timeoutAfterWrite(){failAfterWrite=true;},changeSource(){stage='subscriber';revision='2026-10-23T13:00:00Z';}};
}
export const accounts={shopify:{account:'101',host:'https://synthetic-happytohelp-1.myshopify.com'},stripe:{account:'synthetic-happytohelp-101'},hubspot:{account:'301'},salesforce:{account:'synthetic-happytohelp-501',host:'https://synthetic-happytohelp-1.my.salesforce.com'},orbit:{account:'synthetic-happytohelp-601'}};
const network=createNetwork();export default request=>network.handle(request);
