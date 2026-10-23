// Protocol fixtures exist only at fetch. Application routes, D1, approval, custody and browser rendering remain real.
function assertProtocol(data){if(!data.query.includes('@idempotent(key:$key)')||!data.variables.key||data.variables.input.notify!==false)throw Error('Invalid Shopify refund protocol');}
export function createNetwork(){
 const calls=[],refunds=[],credits=[],shopifyRefunds=[],notes=new Map(),tasks=new Map(),activities=new Map();let failAfterWrite=false,stage='customer',revision='2026-10-23T12:00:00Z',subscriptionCancelled=false,subscriptionMetadata={},taxStatus='complete',balance=0,paused=null,currentPrice='synthetic-happytohelp-303';
 const json=value=>Response.json(value),customer='synthetic-happytohelp-201',payment='synthetic-happytohelp-202',subscription='synthetic-happytohelp-203';
 const handle=async request=>{
  const url=new URL(request.url),path=url.pathname,body=request.method==='GET'?null:await request.text(),data=body?(request.headers.get('content-type')?.includes('application/x-www-form-urlencoded')?Object.fromEntries(new URLSearchParams(body)):JSON.parse(body)):null;
  calls.push({host:url.hostname,path,method:request.method,data,headers:Object.fromEntries(request.headers)});
  const writeResult=value=>{if(failAfterWrite){failAfterWrite=false;throw Error('synthetic network timeout after provider commit');}return json(value);};
  if(url.hostname==='synthetic-happytohelp-1.myshopify.com'){
   if(data.query.includes('currentAppInstallation'))return json({data:{shop:{id:'gid://shopify/Shop/101',myshopifyDomain:url.hostname},currentAppInstallation:{accessScopes:[{handle:'read_orders'},{handle:'read_customers'}]}}});
   if(data.query.includes('BusinessRefundPreview')){if(data.variables.id!=='gid://shopify/Order/901')return json({data:{order:null}});const remaining=(10000-shopifyRefunds.length*1250)/100;const bag={presentmentMoney:{amount:remaining.toFixed(2),currencyCode:'USD'}};return json({data:{order:{id:data.variables.id,name:'#901',customer:{id:'gid://shopify/Customer/'+customer},currencyCode:'USD',presentmentCurrencyCode:'USD',refundable:true,totalTaxSet:{shopMoney:{amount:'5.00',currencyCode:'USD'}},totalShippingPriceSet:{shopMoney:{amount:'10.00',currencyCode:'USD'}},suggestedRefund:{maximumRefundableSet:bag,suggestedTransactions:[{kind:'REFUND',gateway:'synthetic-happytohelp-1',maximumRefundableSet:bag,parentTransaction:{id:'gid://shopify/OrderTransaction/902'}}]}}}});}
   if(data.query.includes('BusinessRefundReadback'))return json({data:{order:{id:data.variables.id,customer:{id:'gid://shopify/Customer/'+customer},refunds:shopifyRefunds}}});
   if(data.query.includes('mutation BusinessRefund(')){assertProtocol(data);const input=data.variables.input,transaction=input.transactions[0],bag={presentmentMoney:{amount:transaction.amount,currencyCode:'USD'}},existing=shopifyRefunds.find(x=>x.note.endsWith(data.variables.key));if(existing)return json({data:{refundCreate:{refund:{id:existing.id},userErrors:[]}}});const result={id:'gid://shopify/Refund/'+(903+shopifyRefunds.length),note:input.note,totalRefundedSet:bag,transactions:{nodes:[{id:'gid://shopify/OrderTransaction/904',kind:'REFUND',status:'SUCCESS',amountSet:bag}]}};shopifyRefunds.push(result);return writeResult({data:{refundCreate:{refund:{id:result.id},userErrors:[]}}});}
   const source=data.variables?.id;if(source!=='gid://shopify/Customer/'+customer)return json({data:{customer:null}});
   return json({data:{customer:{id:source,displayName:'Synthetic customer',orders:{pageInfo:{hasNextPage:false},nodes:[{id:'gid://shopify/Order/901',name:'#901',displayFinancialStatus:'PAID',displayFulfillmentStatus:'FULFILLED',totalPriceSet:{shopMoney:{amount:'100.00',currencyCode:'USD'}},totalTaxSet:{shopMoney:{amount:'5.00',currencyCode:'USD'}},totalShippingPriceSet:{shopMoney:{amount:'10.00',currencyCode:'USD'}},totalRefundedSet:{shopMoney:{amount:'0.00',currencyCode:'USD'}},fulfillments:[{status:'SUCCESS',trackingInfo:[{company:'Synthetic delivery',number:'901'}]}],returns:{nodes:[]},refunds:[]}]}}}});
  }
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
  if(url.hostname==='api.hubapi.com'){
   if(path==='/account-info/v3/details')return json({portalId:301});
   if(path==='/crm/v3/objects/contacts/'+customer)return json({id:customer,updatedAt:revision,properties:{firstname:'Synthetic',lastname:'Customer',company:'Synthetic account',hubspot_owner_id:'801',lifecyclestage:stage,support_entitlement:stage,plan:'Synthetic plan'}});
   if(path==='/crm/v3/objects/notes'&&data){const r={id:'synthetic-happytohelp-note-'+notes.size,properties:data.properties,associations:{contacts:{results:[{id:data.associations[0].to.id}]}}};notes.set(r.id,r);return writeResult(r);}
   if(path.startsWith('/crm/v3/objects/notes/'))return json(notes.get(path.split('/').pop()));
  }
  if(url.hostname==='synthetic-happytohelp-1.my.salesforce.com'){
   if(path==='/services/oauth2/userinfo')return json({organization_id:'synthetic-happytohelp-501'});
   if(path==='/services/data/v66.0/sobjects/Contact/'+customer)return json({Id:customer,Name:'Synthetic customer',AccountId:'801',OwnerId:'802',LastModifiedDate:revision,Support_Entitlement__c:stage,Plan__c:'Synthetic plan'});
   if(path==='/services/data/v66.0/sobjects/Task'&&data){const r={Id:'synthetic-happytohelp-task-'+tasks.size,...data};tasks.set(r.Id,r);return writeResult({id:r.Id,success:true});}
   if(path.startsWith('/services/data/v66.0/sobjects/Task/'))return json(tasks.get(path.split('/').pop()));
  }
  return new Response('Unavailable',{status:404});
 };
 return {handle,calls,refunds,credits,shopifyRefunds,notes,tasks,activities,customer,payment,subscription,taxUnavailable(value){taxStatus=value?'failed':'complete';},timeoutAfterWrite(){failAfterWrite=true;},changeSource(){stage='subscriber';revision='2026-10-23T13:00:00Z';}};
}
export const accounts={shopify:{account:'101',host:'https://synthetic-happytohelp-1.myshopify.com'},stripe:{account:'synthetic-happytohelp-101'},hubspot:{account:'301'},salesforce:{account:'synthetic-happytohelp-501',host:'https://synthetic-happytohelp-1.my.salesforce.com'}};
const network=createNetwork();export default request=>network.handle(request);
