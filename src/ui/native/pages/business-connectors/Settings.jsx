import './controls.css';
import React,{useEffect,useId,useState} from 'react';
import {nativeRequest} from '../../transport';
import {command,names,money} from './api';
export default function BusinessSettings({projectId,role}){
 const root=`/api/business/projects/${projectId}/connections`,prefix=useId();
 const [rows,setRows]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const [provider,setProvider]=useState('shopify'),[account,setAccount]=useState(''),[host,setHost]=useState(''),[token,setToken]=useState(''),[scopes,setScopes]=useState(['read']),[limit,setLimit]=useState('0'),[expiry,setExpiry]=useState(''),[plan,setPlan]=useState(''),[entitlement,setEntitlement]=useState(''),[accountPlan,setAccountPlan]=useState(''),[accountEntitlement,setAccountEntitlement]=useState(''),[contactFields,setContactFields]=useState(''),[accountFields,setAccountFields]=useState('');
 const allowed=['owner','admin'].includes(role);
 const load=async()=>setRows((await nativeRequest(root)).data);
 useEffect(()=>{let active=true;setRows([]);if(allowed)nativeRequest(root).then(r=>{if(active)setRows(r.data);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[root,allowed]);
 const act=async task=>{if(busy)return;setBusy(true);setError('');setNotice('');try{await task();await load();}catch(e){setError(e.message);}finally{setBusy(false);}};
 const field=(name,label,value,set,type='text',extra={})=><div className="mb-3"><label className="form-label" htmlFor={prefix+name}>{label}</label><input id={prefix+name} className="form-control" type={type} value={value} onChange={e=>set(e.target.value)} {...extra}/></div>;
 if(!allowed)return <p role="alert">Only workspace owners and admins can manage business connections.</p>;
 return <div className="workspace-settings connections-page business-connections" style={{maxWidth:800,overflowWrap:'anywhere'}} aria-busy={busy}>
  <p>Connect each merchant or CRM account separately. Map customers explicitly from a ticket. Credentials are encrypted, never displayed again and excluded from backups.</p>
  {error&&<p className="alert alert-danger" role="alert">{error}</p>}{notice&&<p className="alert alert-info" role="status">{notice}</p>}
  <form onSubmit={e=>{e.preventDefault();act(async()=>{await command(root,{provider,account,host:host||undefined,token,scopes,fields:{...(plan?{plan}:{}),...(entitlement?{entitlement}:{}),...(accountPlan?{account_plan:accountPlan}:{}),...(accountEntitlement?{account_entitlement:accountEntitlement}:{}),editable_contact:contactFields.split(',').map(x=>x.trim()).filter(Boolean),editable_account:accountFields.split(',').map(x=>x.trim()).filter(Boolean)},limit_cents:Math.round(Number(limit)*100),expires_at:expiry?new Date(expiry).getTime():null});setToken('');setNotice('Account verified and connected.');});}}>
   <fieldset disabled={busy}><legend className="h4">Connect a business account</legend>
    <label className="form-label" htmlFor={prefix+'provider'}>Provider</label><select className="form-select mb-3" id={prefix+'provider'} value={provider} onChange={e=>{setProvider(e.target.value);setHost('');}}>{Object.entries(names).map(([key,name])=><option value={key} key={key} disabled={key==='orbit'}>{name}{key==='orbit'?' — unavailable':''}</option>)}</select>
    {field('account','Provider account ID',account,setAccount,'text',{required:true,maxLength:200})}
    {field('host','Provider HTTPS origin (required for Shopify and Salesforce)',host,setHost,'url',{required:['shopify','salesforce'].includes(provider),placeholder:provider==='shopify'?'https://your-store.myshopify.com':provider==='salesforce'?'https://your-org.my.salesforce.com':'Uses the fixed provider API host'})}
    {['hubspot','salesforce'].includes(provider)&&<>{field('plan','CRM plan property (optional)',plan,setPlan,'text',{pattern:'[A-Za-z_][A-Za-z0-9_]{0,79}'})}{field('entitlement','CRM support entitlement property (optional)',entitlement,setEntitlement,'text',{pattern:'[A-Za-z_][A-Za-z0-9_]{0,79}'})}<details className="mb-3"><summary>Company fields and approved edits</summary>{field('account-plan','Company or account plan property',accountPlan,setAccountPlan)}{field('account-entitlement','Company or account entitlement property',accountEntitlement,setAccountEntitlement)}{field('contact-fields','Editable contact properties (comma separated)',contactFields,setContactFields)}{field('account-fields','Editable company or account properties (comma separated)',accountFields,setAccountFields)}</details><p>Choose the source properties your team uses. Sales lifecycle confers no support entitlement.</p></>}
    {field('token','Provider credential',token,setToken,'password',{required:true,autoComplete:'new-password',maxLength:10000})}
    <fieldset className="mb-3"><legend className="h5">Local action grants</legend><p>These grants narrow provider authority. The provider must also permit each operation. Approval always requires an authorized human and a recent identity check.</p>{['read','prepare','approve','execute'].map(scope=><label className="d-block mb-2" key={scope}><input type="checkbox" checked={scopes.includes(scope)} onChange={e=>setScopes(e.target.checked?[...scopes,scope]:scopes.filter(x=>x!==scope))}/> {scope}</label>)}</fieldset>
    {field('limit','Maximum per action (USD)',limit,setLimit,'number',{required:true,min:0,max:1000000,step:'0.01'})}
    {field('expiry','Credential expiry (optional, local time)',expiry,setExpiry,'datetime-local')}
    <button className="btn btn-primary" disabled={!scopes.includes('read')}>Verify and connect</button>
   </fieldset>
  </form>
  <details className="mt-3"><summary>Supported business actions</summary><p>Shopify supports USD refunds with original-payment allocations, item tax and shipping previews, approved returns and order cancellation without an automatic refund. Stripe supports USD refunds, future-invoice credits, collection pause, period-end cancellation and prorated plan changes. Plan changes preserve quantity on one item and the billing interval. CRM outcomes are explicit approved notes or activities. Field edits require a configured property, an exact before/after preview and approval; plan and entitlement use only the source properties you explicitly select. </p></details>
  <p role="status">Orbit connections are unavailable.</p>
  <h3 className="h4 mt-4">Business accounts</h3>{!rows.length&&<p>No business accounts connected.</p>}
  {rows.map(row=><article className="card mb-3" key={row.id}><div className="card-body"><h4>{names[row.provider]} · {row.account}</h4><p>{!row.connected&&'Disconnected · '}Grants: {row.scopes.join(', ')} · Limit: {money(row.limit_cents)} per action · Expires: {row.expires_at?new Date(row.expires_at).toLocaleString():'No expiry'}</p>{row.connected&&<button className="btn btn-outline-danger" disabled={busy} onClick={()=>act(async()=>{await command(root+'/'+encodeURIComponent(row.id),undefined,'DELETE');setNotice('Disconnected. Cached context is stale and actions are refused.');})}>Disconnect {names[row.provider]} {row.account}</button>}</div></article>)}
 </div>;
}
