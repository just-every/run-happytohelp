import React from 'react';
import {money} from './api';
export default function BusinessContext({link}){
 if(!link)return <p>No customer mapped.</p>;
 const value=link.context;
 return <><p>Source: {link.source_id}<br/>{link.stale?'Stale / unavailable':'Current'} · Last synced: {link.fetched_at?new Date(link.fetched_at).toLocaleString():'Never'}{link.error&&<> · {link.error}</>}</p>{value&&<>
  <p>{value.customer||'Customer name unavailable'}</p>
  {['company','owner','plan','entitlement','source_revision'].map(key=>key in value&&<p key={key}>{key.replaceAll('_',' ')}: {value[key]??'Unavailable from this connector'}</p>)}
  {value.orders?.map(order=><article key={order.id}><h5>Order {order.name}</h5><p>{order.financial} · {order.fulfillment}<br/>Total: {order.total?.currency} {order.total?.amount} · Tax: {order.tax?.amount??'Unavailable'} · Shipping: {order.shipping?.amount??'Unavailable'}<br/>Refunded: {order.refunded?.amount??'Unavailable'}</p>{order.delivery.map((d,i)=><p key={i}>Delivery: {d.status} {d.tracking.map(t=>[t.company,t.number].filter(Boolean).join(' ')).join(', ')}</p>)}{order.returns.map(r=><p key={r.id}>Return: {r.status}</p>)}{order.refunds.map(r=><p key={r.id}>Refund {r.id}: {r.total?.currency} {r.total?.amount}</p>)}</article>)}
  {value.invoices?.map(invoice=><article key={invoice.id}><h5>Invoice {invoice.id}</h5><p>{invoice.status} · {invoice.currency?.toUpperCase()} {invoice.total_cents/100}<br/>Tax: {invoice.tax_cents==null?'Unavailable':invoice.tax_cents/100}<br/>Payment: {invoice.payment_intent??'Unavailable'}</p></article>)}
  {value.subscriptions?.map(sub=><p key={sub.id}>Subscription {sub.id}: {sub.status} · {sub.cancel_at_period_end?'Cancels at period end':'Continues'}</p>)}
  {value.truncated&&<p role="status">More records exist at the provider. This is a bounded first page.</p>}
 </>}</>;
}
