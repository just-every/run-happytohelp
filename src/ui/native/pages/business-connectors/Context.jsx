import React from 'react';
import {money} from './api';
export default function BusinessContext({link}){
 if(!link)return <p>No customer mapped.</p>;
 const value=link.context;
 return <><p>Source: {link.source_id}<br/>{link.stale?'Stale / unavailable':'Current'} · Last synced: {link.fetched_at?new Date(link.fetched_at).toLocaleString():'Never'}{link.error&&<> · {link.error}</>}</p>{value&&<>
  <p>{value.customer||'Customer name unavailable'}</p>
  <p>{['owner','plan','entitlement','lifecycle'].filter(key=>key in value).map((key,i)=><React.Fragment key={key}>{i>0&&' · '}{key}: {value[key]??'Unavailable'}</React.Fragment>)}</p>
  {value.accounts?.map(account=><article key={account.id}><h5>{account.name||'Account '+account.id}</h5><p>Source: {account.id} · Owner: {account.owner||'Unavailable'} · Plan: {account.plan||'Unavailable'} · Support: {account.entitlement||'Unavailable'} · Source updated: {account.source_revision||'Unavailable'}</p></article>)}
  {value.orders?.map(order=><article key={order.id}><h5>Order {order.name}</h5><p>{order.financial} · {order.fulfillment}<br/>Total: {order.total?.currency} {order.total?.amount} · Tax: {order.tax?.amount??'Unavailable'} · Shipping: {order.shipping?.amount??'Unavailable'}<br/>Refunded: {order.refunded?.amount??'Unavailable'}</p>{order.delivery.map((d,i)=><p key={i}>Delivery: {d.status} {d.tracking.map(t=>[t.company,t.number].filter(Boolean).join(' ')).join(', ')}</p>)}{order.returns.map(r=><p key={r.id}>Return: {r.status}</p>)}{order.refunds.map(r=><p key={r.id}>Refund {r.id}: {r.total?.currency} {r.total?.amount}</p>)}</article>)}
  {value.invoices?.map(invoice=><article key={invoice.id}><h5>Invoice {invoice.id}</h5><p>{invoice.status} · {invoice.currency?.toUpperCase()} {invoice.total_cents/100}<br/>Tax: {invoice.tax_cents==null?'Unavailable':invoice.tax_cents/100}<br/>Payment: {invoice.payment_intent??'Unavailable'}</p></article>)}
  {value.subscriptions?.map(sub=><p key={sub.id}>Subscription {sub.id}: {sub.status} · {sub.cancel_at_period_end?'Cancels at period end':'Continues'}{sub.pause_collection&&' · Collection paused: '+sub.pause_collection}{sub.prices?.map(p=><span key={p.item_id}><br/>Price: {p.price_id} · {p.currency?.toUpperCase()} {p.unit_amount_cents/100}</span>)}</p>)}
  {value.truncated&&<p role="status">More records exist at the provider. This is a bounded first page.</p>}
 </>}</>;
}
