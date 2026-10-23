// Explicit held-key qualification, never registered in push Verify. Synthetic
// records only; run with _od08-env.py STRIPE_SECRET_KEY=STRIPE_TEST_SECRET_KEY.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {startApp} from '../../journeys/kit/app.mjs';
import {provisionStripeSandbox} from './stripe-sandbox-setup.mjs';

const key=process.env.STRIPE_SECRET_KEY;
assert.ok(/^(sk|rk)_test_/.test(key??''),'A held Stripe TEST credential is required');
const statuses={},checks=[];
const stripe=async(path,{method='GET',body,headers={}}={})=>{
 const response=await fetch('https://api.stripe.com'+path,{method,headers:{Authorization:'Bearer '+key,'Stripe-Version':'2024-06-20',...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{}),...headers},body:body?new URLSearchParams(body).toString():undefined,redirect:'manual',signal:AbortSignal.timeout(15000)});
 statuses[response.status]=(statuses[response.status]??0)+1;
 assert.ok(response.ok,'Stripe sandbox HTTP '+response.status);
 const result=await response.json();assert.notEqual(result.livemode,true,'Live Stripe records are refused');return result;
};
let app,resources;
try{
 resources=await provisionStripeSandbox(stripe);
 const {account,customer,subscription,payment,nextPrice}=resources;
 let loseRefund=false,refundPosts=0;
 app=await startApp({bindings:{INTEGRATION_ENCRYPTION_KEY:randomBytes(32).toString('base64')},outbound:async request=>{
  const url=new URL(request.url);assert.equal(url.origin,'https://api.stripe.com');
  const body=request.method==='GET'?undefined:await request.text();
  const response=await fetch(url,{method:request.method,headers:Object.fromEntries(request.headers),body,redirect:'manual',signal:AbortSignal.timeout(15000)});
  statuses[response.status]=(statuses[response.status]??0)+1;
  if(!response.ok){const error=(await response.clone().json().catch(()=>({}))).error??{};process.stderr.write(JSON.stringify({stripeStatus:response.status,code:error.code,type:error.type,param:error.param})+'\n');}
  if(url.pathname==='/v1/refunds'&&request.method==='POST'){
   refundPosts++;assert.equal(new URLSearchParams(body).get('amount'),'125');
   if(loseRefund){loseRefund=false;assert.ok(response.ok,'Stripe accepted the bounded refund');await response.arrayBuffer();throw new Error('Synthetic lost response after Stripe commit');}
  }
  return response;
 }});
 const ws=await app.seedWorkspace('stripe-sandbox'),base=`/api/business/projects/${ws.projectId}`;
 await app.presenceAwayOff(ws.projectId);
 const headers={Origin:ws.allowedOrigin,'CF-Connecting-IP':'198.51.100.81'};
 const visitor=await app.ok('/api/identity/widget/session',{headers,body:{widgetKey:ws.widgetKey,name:'Synthetic customer',email:'synthetic-happytohelp-1@example.test'}});
 const conversation=await app.ok('/api/conversations',{token:visitor.token,headers,body:{projectId:ws.projectId}}),ticket='/conversations/'+conversation.id;
 const call=(path,body,token=ws.tokens.owner)=>app.ok(base+path,{token,body});
 const connection=(await call('/connections',{provider:'stripe',account:account.id,token:key,scopes:['read','prepare','approve','execute'],limit_cents:10000})).data;
 const mapped=ticket+'/connections/'+encodeURIComponent(connection.id);
 await call(mapped+'/map',{source_id:customer.id,confirmed:true});await call(mapped+'/refresh',{});
 const context=(await call(ticket)).data.connections[0].link.context;
 assert.ok(context.invoices.some(invoice=>invoice.status==='paid'&&invoice.payment_intent===payment));checks.push('configured-account-paid-invoice');
 const prepare=async(kind,target,extra={})=>(await call(mapped+'/prepare',{kind,target_id:target,reason:'Synthetic customer approved sandbox '+kind,request_key:randomUUID(),...extra})).data;
 const run=async action=>{const root=mapped+'/actions/'+action.id;await call(root+'/approve',{confirmed:true});const result=await call(root+'/execute',{});assert.equal(result.data.state,'succeeded');return result.data;};
 const refund=await prepare('refund',payment,{amount_cents:125}),refundRoot=mapped+'/actions/'+refund.id;
 assert.equal((await app.call(base+refundRoot+'/approve',{token:ws.tokens.operator,body:{confirmed:true}})).status,403);checks.push('denied-approval');
 await call(refundRoot+'/approve',{confirmed:true});loseRefund=true;assert.equal((await call(refundRoot+'/execute',{})).state,'uncertain');
 assert.equal((await app.call(base+refundRoot+'/execute',{token:ws.tokens.owner,body:{}})).status,409);
 const reconciled=(await call(refundRoot+'/reconcile',{})).data;assert.equal(reconciled.state,'succeeded',JSON.stringify(reconciled.result));
 assert.equal((await call(refundRoot+'/execute',{})).data.state,'succeeded');assert.equal(refundPosts,1);
 const ledger=await stripe('/v1/refunds?payment_intent='+payment+'&limit=100');assert.equal(ledger.data.filter(row=>row.metadata?.h2h_action===refund.id&&row.amount===125).length,1);checks.push('lost-refund-response-reconciled-once');
 const frontier=await app.ok('/api/conversations/'+conversation.id,{token:ws.tokens.owner});
 const confirmation={content:'Your USD 1.25 refund is confirmed by Stripe.',expectedRevision:frontier.revision,expectedLastMessageId:frontier.last_message_id};
 const sent=await call(ticket+'/actions/'+refund.id+'/send',confirmation);assert.equal((await call(ticket+'/actions/'+refund.id+'/send',confirmation)).message.id,sent.message.id);
 const transcript=await app.ok('/api/conversations/'+conversation.id+'/messages',{token:visitor.token});assert.equal(transcript.messages.filter(row=>row.id===sent.message.id&&row.content===confirmation.content).length,1);checks.push('reviewed-customer-confirmation-once');
 const plan=await prepare('change_plan',subscription.id,{price_id:nextPrice.id});assert.ok(plan.preview.proration_lines.length);assert.ok(Number.isSafeInteger(plan.preview.tax_cents));const upgraded=await run(plan);assert.equal(upgraded.result.next_price,nextPrice.id);assert.equal(upgraded.result.amount_cents,plan.amount_cents);checks.push('paid-prorated-plan-readback');
 const credit=await run(await prepare('credit',customer.id,{amount_cents:50}));assert.equal(credit.result.balance_after_cents,-50);checks.push('invoice-credit-readback');
 const paused=await run(await prepare('pause_subscription',subscription.id));assert.equal(paused.result.collection,'keep_as_draft');checks.push('collection-pause-readback');
 const cancelled=await run(await prepare('cancel_subscription',subscription.id));assert.equal(cancelled.result.cancel_at_period_end,true);checks.push('period-end-cancellation-readback');
 process.stdout.write(JSON.stringify({provider:'Stripe TEST',checkedAt:new Date().toISOString(),checks,statuses,refundPosts,result:'passed'})+'\n');
}finally{
 await app?.close();
 await resources?.cleanup();
}
