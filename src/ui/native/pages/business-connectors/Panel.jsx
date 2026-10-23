import React,{useEffect,useId,useState} from 'react';
import {nativeRequest} from '../../transport';
import {command,names,money} from './api';
import BusinessContext from './Context';
function CustomerConnection({connection,root,act,busy}){
 const prefix=useId(),[source,setSource]=useState(''),[confirmed,setConfirmed]=useState(false),[kind,setKind]=useState(['shopify','stripe'].includes(connection.provider)?'refund':'support_outcome'),[target,setTarget]=useState(''),[amount,setAmount]=useState(''),[reason,setReason]=useState(''),[requestKey,setRequestKey]=useState(()=>crypto.randomUUID());
 const base=root+'/connections/'+encodeURIComponent(connection.id),isCrm=['orbit','hubspot','salesforce'].includes(connection.provider);
 return <details><summary>{names[connection.provider]} · {connection.account} · {connection.connected?'Connected':'Disconnected'}</summary>
  <BusinessContext link={connection.link}/>
  {connection.connected&&<><form onSubmit={e=>{e.preventDefault();act(()=>command(base+'/map',{source_id:source,confirmed}));}}><fieldset disabled={busy}><legend className="h6">Map provider customer</legend><label htmlFor={prefix+'source'}>Provider customer ID</label><input className="form-control mb-2" id={prefix+'source'} required value={source} onChange={e=>setSource(e.target.value)}/><label className="d-block mb-2"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> I verified this provider customer is the requester. Email alone is insufficient.</label><button className="btn btn-sm btn-outline-secondary" disabled={!confirmed}>Map customer</button></fieldset></form>
   {connection.link&&<button type="button" className="btn btn-sm btn-outline-secondary mt-2" disabled={busy} onClick={()=>act(()=>command(base+'/refresh',{}))}>Refresh {names[connection.provider]} context</button>}
   {connection.link&&connection.provider==='shopify'&&<p className="mt-2">USD amount-only refunds are available for a single payment gateway. Returns, restocking and order cancellation are not yet supported. Live sandbox qualification is pending.</p>}
   {connection.link&&(['shopify','stripe'].includes(connection.provider)||isCrm)&&<form className="mt-3" onSubmit={e=>{e.preventDefault();act(async()=>{await command(base+'/prepare',{kind,target_id:isCrm?connection.link.source_id:target,amount_cents:kind==='refund'?Math.round(Number(amount)*100):0,reason,request_key:requestKey});setRequestKey(crypto.randomUUID());});}}><fieldset disabled={busy}><legend className="h6">Prepare an action</legend>
    <label htmlFor={prefix+'kind'}>Business action</label><select className="form-select mb-2" id={prefix+'kind'} value={kind} onChange={e=>setKind(e.target.value)}>{isCrm?<option value="support_outcome">Publish support outcome</option>:<><option value="refund">Refund payment</option>{connection.provider==='stripe'&&<option value="cancel_subscription">Cancel subscription at period end</option>}</>}</select>
    {!isCrm&&<><label htmlFor={prefix+'target'}>Order, payment intent or subscription ID</label><input className="form-control mb-2" id={prefix+'target'} required value={target} onChange={e=>setTarget(e.target.value)}/></>}
    {kind==='refund'&&<><label htmlFor={prefix+'amount'}>Refund amount (USD)</label><input className="form-control mb-2" id={prefix+'amount'} required min="0.01" max={connection.limit_cents/100} step="0.01" type="number" value={amount} onChange={e=>setAmount(e.target.value)}/></>}
    <label htmlFor={prefix+'reason'}>{isCrm?'Outcome shared with the CRM':'Reason'}</label><textarea className="form-control mb-2" id={prefix+'reason'} required maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)}/><button className="btn btn-sm btn-outline-primary">Preview business action</button>
   </fieldset></form>}
  </>}
 </details>;
}
export default function BusinessPanel({projectId,conversationId}){
 const root=`/api/business/projects/${projectId}/conversations/${conversationId}`,[data,setData]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const load=async()=>setData((await nativeRequest(root)).data);
 useEffect(()=>{let live=true;setData(null);setError('');nativeRequest(root).then(r=>{if(live)setData(r.data);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[root]);
 const act=async task=>{if(busy)return;setBusy(true);setError('');try{await task();}catch(e){setError(e.message);}finally{await load().catch(e=>setError(e.message));setBusy(false);}};
 return <div aria-busy={busy} style={{overflowWrap:'anywhere'}}>{error&&<p className="text-danger" role="alert">{error}</p>}<p>Business data stays at its source. <a href={`/projects/${projectId}/business-settings`}>Manage business connections</a></p><button className="btn btn-sm btn-outline-secondary mb-2" disabled={busy} onClick={()=>act(async()=>{})}>Refresh business panel</button>
  {data?.connections.map(connection=><CustomerConnection key={root+connection.id} connection={connection} root={root} act={act} busy={busy}/>)}{data&&!data.connections.length&&<p>No business accounts connected.</p>}
  {data?.actions.map(action=>{const base=root+'/connections/'+encodeURIComponent(action.connection_id)+'/actions/'+action.id;return <article className="card mt-3" key={action.id}><div className="card-body"><h5>{action.kind.replaceAll('_',' ')} · {action.state}</h5><p>Provider record: {action.target_id}<br/>Amount: {money(action.amount_cents)}<br/>Reason: {action.reason}</p>{Object.entries(action.preview).filter(([k])=>['tax','shipping','effective','effective_at','proration','notice'].includes(k)).map(([key,value])=><p key={key}>{key.replaceAll('_',' ')}: {String(value)}</p>)}
   {action.state==='prepared'&&<button className="btn btn-sm btn-outline-primary" disabled={busy} onClick={()=>act(()=>command(base+'/approve',{confirmed:true}))}>Approve exact preview</button>}
   {action.state==='approved'&&<button className="btn btn-sm btn-primary" disabled={busy} onClick={()=>act(()=>command(base+'/execute',{}))}>Execute approved action</button>}
   {['prepared','approved'].includes(action.state)&&<button className="btn btn-sm btn-outline-secondary ms-2" disabled={busy} onClick={()=>act(()=>command(base+'/cancel',{}))}>Cancel action</button>}
   {['sending','uncertain'].includes(action.state)&&<><p role="status">Provider outcome is unconfirmed. Do not repeat this action.</p><button className="btn btn-sm btn-outline-secondary" disabled={busy} onClick={()=>act(()=>command(base+'/reconcile',{}))}>Reconcile provider result</button></>}
   {action.result&&<p role="status">Provider result: {action.result.provider_status||action.result.state||action.result.code}. {action.state==='succeeded'?'Confirmed at provider. Review the result before replying to the customer.':'Customer success is not confirmed.'}</p>}
  </div></article>;})}
 </div>;
}
