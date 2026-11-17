import React,{useEffect,useState} from 'react';
import {nativeRequest} from '../../transport';

const scopeName = scope => {
 const [resource, action] = scope.split(':');
 return `${resource.charAt(0).toUpperCase() + resource.slice(1)}: ${{read:'read',write:'change',create:'create',append:'add messages'}[action] || action}`;
};
function Attempt({attempt,tokenSettings}) {
 const bearer = attempt.event === 'bearer.request', denied = ['refused','rejected'].includes(attempt.state);
 const description = bearer ? denied ? 'API request refused' : 'API request accepted' : attempt.event.split(/[._]/).join(' ');
 return <div><p>Attempt {attempt.number}: {description}{!bearer ? ` · ${attempt.state}` : ''}{attempt.status ? ` · HTTP ${attempt.status}` : ''}</p>
  {bearer && attempt.scopes?.length > 0 && <p>Required access: {attempt.scopes.map(scopeName).join(', ')}</p>}
  {denied && (bearer ? <p>Review <a href={tokenSettings}>API token settings</a>: use an active, unexpired token with the required access. Ask a workspace administrator to issue a replacement with only the access your task needs. If access is already correct, check request limits before retrying.</p> : <p>The connection refused this attempt. Review its account permissions and destination settings before trying again.</p>)}
  {attempt.error_class && !denied && <p>The connection needs attention. Review its settings and recent delivery attempts.</p>}
  <details><summary>Technical details</summary><p>Event: <code>{attempt.event}</code>{attempt.error_class && <> · Code: <code>{attempt.error_class}</code></>}</p></details>
 </div>;
}
export default function Connectors({root}){
 const tokenSettings = root.replace('/api/management', '').replace(/\/connections$/, '/api-settings');
 const [rows,setRows]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const load=async signal=>{const result=await nativeRequest(root+'/connectors',{signal});setRows(result.data);};
 useEffect(()=>{const controller=new AbortController();setRows(null);setError('');setNotice('');load(controller.signal).catch(e=>{if(!controller.signal.aborted)setError(e.message);});return()=>controller.abort();},[root]);
 const reconcile=async action=>{if(busy)return;setBusy(true);setError('');setNotice('');try{await nativeRequest(root+action.path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(action.body)});setNotice(action.path.endsWith('/pull')?'Pull staged. Review its import before applying.':'Resend queued. Check delivery attempts for its result.');await load();}catch(e){setError(e.message);}finally{setBusy(false);}};
 return <section className="connector-catalog" aria-labelledby="connector-health-heading" aria-busy={busy}>
  <h2 id="connector-health-heading">Connection health</h2><p>Review access and recent attempts. Reconcile a connection deliberately when it needs attention.</p>
  {error&&<p role="alert" className="alert alert-danger">{error}</p>}{notice&&<p role="status">{notice}</p>}
  <button type="button" className="btn btn-white" disabled={busy} onClick={()=>{setError('');load().catch(e=>setError(e.message));}}>Refresh connection health</button>
  {rows===null?<p>Loading connection health…</p>:<ul className="connector-list">{rows.map(row=><li key={row.id}>
   <div className="connector-heading"><h3>{row.name}</h3><span className={'connector-health connector-health--'+row.health}>{row.health}{!row.configured?' · unconfigured':''}</span></div>
   <p>Access: {row.scopes.length?row.scopes.join(', '):'No active scopes'}</p>
   <p>Queued: {row.queued} · Uncertain: {row.uncertain} · Failed: {row.failed}</p>
   {row.id==='helpscout'&&<p>Cursor: {row.cursor||'Not pulled'} · Last pull: {row.last_pull_at?new Date(row.last_pull_at).toISOString():'Never'} · Changes waiting: {row.waiting_events}{row.error_class?' · Connection needs attention. Check its credentials and request limits before pulling again.':''}{row.skipped_erased?' · Erased conversations skipped: '+row.skipped_erased:''}</p>}
   {row.error_class&&<details><summary>Technical details</summary><p>Code: <code>{row.error_class}</code></p></details>}
   {row.attempts.slice(0,3).map(attempt=><Attempt key={attempt.id} attempt={attempt} tokenSettings={tokenSettings}/>)}
   {row.reconciliation.slice(0,3).map(action=><button type="button" key={action.path} className="btn btn-white" disabled={busy} onClick={()=>reconcile(action)}>{action.label}</button>)}
  </li>)}</ul>}
 </section>;
}
