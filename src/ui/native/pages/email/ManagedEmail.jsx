import React,{useState} from 'react';
import {Section} from '../forms';
import OwnerTestMail from '../../activation/OwnerTestMail';
import Mailboxes from './Mailboxes';
import {nativeRequest} from '../../transport';
const at=value=>value?new Date(value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}):'Not observed yet';

/** Managed transport status is configuration, routing and observations separately.
 * None of these states substitutes an MX lookup or acceptance for delivery. */
export default function ManagedEmail({managed,field,role,projectId,onRefresh}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const reconcile=async()=>{setBusy(true);setError('');try{await nativeRequest(`/api/management/projects/${projectId}/email-settings/managed/reconcile`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({deliveryId:managed.outbound.id})});await onRefresh();}catch{setError('The retained send receipt is unavailable. No message was sent again.');}finally{setBusy(false);}};
 const retry=async()=>{setBusy(true);setError('');try{await nativeRequest(`/api/management/projects/${projectId}/email-settings/managed/retry`,{method:'POST'});await onRefresh();}catch{setError('The connection could not be retried. Please try again.');}finally{setBusy(false);}};
 return <>
  <Section title="Managed email" description="Your support address is provided by Run Edit Run. No email service account or DNS setup is needed.">
   <p className="sh-state"><b style={{overflowWrap:'anywhere'}}>{managed.address||(managed.state==='failed'?'Support address unavailable':'Assigning your support address…')}</b></p>
   <dl className="settings-grid" aria-label="Managed email status">
    <div><dt>Configuration</dt><dd>{managed.configured?'Configured':'Waiting for Run Edit Run'}</dd></div>
    <div><dt>Receiving route</dt><dd>{managed.routeActive?'Active':'Not active'}</dd></div>
    <div><dt>Inbound email</dt><dd>{managed.observed?'Observed':'Waiting for the first email'}</dd></div>
   </dl>
   <p>Last inbound observation: {at(managed.lastInboundAt)}</p>
   <p>Last outbound provider acceptance: {at(managed.lastOutboundAcceptanceAt)}</p>
   <p className="settings-note">Provider acceptance means the sending service accepted a message. It does not confirm arrival in the recipient’s inbox.</p>
   {managed.error&&<div role="alert" className="alert alert-danger">{managed.error}</div>}
   {managed.outbound&&['failed','uncertain','sending'].includes(managed.outbound.state)&&<p role="status">{managed.outbound.reason|| (managed.outbound.state==='failed'?'The last send failed':managed.outbound.state==='sending'?'The last send is awaiting a provider response':'The last send outcome is uncertain')}. It will not be sent again automatically.</p>}
   {['failed','pending','reserved'].includes(managed.state)&&<button type="button" className="btn btn-white" disabled={busy} onClick={retry}>{busy?'Retrying…':'Retry connection'}</button>}
   {error&&<p role="alert">{error}</p>}
   {managed.outbound?.state==='uncertain'&&<button type="button" className="btn btn-white" disabled={busy} onClick={reconcile}>{busy?'Checking…':'Check retained send receipt'}</button>}
   {managed.state==='active'&&<div className="mt-3">{field('is_enabled','Email customers and your team about conversations','checkbox')}<p className="settings-note">Turning conversation email off also stops new intake. Account recovery email remains available.</p></div>}
  </Section>
  {role==='owner'&&managed.state==='active'&&managed.configured&&<OwnerTestMail projectId={projectId} onComplete={onRefresh} showResult={false}/>}
  <details className="sh-guide"><summary>Use your own email domain later</summary><div className="sh-steps"><p>Connect a mailbox on your domain when you are ready. Your managed address and existing conversations stay available; a domain check never replaces this sender.</p><Mailboxes projectId={projectId} role={role}/></div></details>
 </>;
}
