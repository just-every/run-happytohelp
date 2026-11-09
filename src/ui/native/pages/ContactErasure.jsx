import React,{useEffect,useState} from 'react';
import './security/security.css';
import {nativeRequest} from '../transport';
import {Section} from './forms';
import {useConfirmation} from './ConfirmDialog';

const CONFIRMATION='ERASE';

/** Owner/admin erasure of one contact's personal data, behind the shared dialog's exact typed confirmation. While an
 * erasure of the contact is pending (it failed and still holds its lease), a notice says so; erasing again completes it. */
export default function ContactErasure({projectId,contact,onErased}) {
 const {ask,dialog}=useConfirmation();
 const begin=()=>ask({
  title:'Erase personal data',confirmText:CONFIRMATION,confirmLabel:'Permanently erase',busyLabel:'Erasing…',
  body:<>
   <p>This permanently deletes, and cannot be undone:</p>
   <ul><li>the contact's name, email, identifier, device and location details</li><li>the content of every message in their conversations, and all attachments</li><li>tracked page visits, customer profiles, insights and other customer context</li><li>their widget sessions, internal notes and AI or delegated-work output on their conversations</li></ul>
   <p>Conversations stay in place with their messages marked as erased. A record of who erased the contact, when, and how many records were removed is kept.</p>
  </>,
  run:async()=>{const response=await nativeRequest(`/api/management/projects/${encodeURIComponent(projectId)}/contacts/${encodeURIComponent(contact.id)}/erase`,{method:'POST'});await onErased(response.data);},
 });
 const pending=Boolean(contact.erasure_pending);
 return <div className={`contact-erasure${pending?' contact-erasure--pending':''}`}><Section title="Erase personal data" description="Permanently remove this contact's personal data at their request. Only owners and admins can erase a contact.">
  {pending&&<div role="status" className="alert alert-warning">This contact's erasure did not finish. Erase again to complete it.</div>}
  <button type="button" className="btn btn-outline-danger" onClick={begin}>Erase personal data…</button>
 </Section>{dialog}</div>;
}

const STORES=[['conversations','Conversations redacted'],['messages','Messages erased'],['attachments','Attachments deleted'],['tracked_events','Tracked visits and actions'],['context_records','Customer context records'],['sessions','Widget sessions ended'],['ticket_records','Ticket values, history and saved views redacted']];
const STATES={completed:'Deleted by provider',pending:'Request sent, waiting',failed:'Request failed',unsupported:'Provider cannot delete'};
const PROVIDERS={webhook:'Webhook',slack:'Slack',email_provider:'Email provider',ai_provider:'AI provider',local_computers:'Paired computers'};

/** What erasure removed here, store by store, and what each connected provider was asked to delete. Read again once a
 * pending erasure completes, so the record shows that run and its provider requests. */
export function ContactErased({projectId,contact}) {
 const [record,setRecord]=useState(null);
 useEffect(()=>{if(projectId)nativeRequest(`/api/management/projects/${encodeURIComponent(projectId)}/contacts/${encodeURIComponent(contact.id)}/erasure`).then(r=>setRecord(r.data)).catch(()=>setRecord(null));},[projectId,contact.id,contact.erasure_pending]);
 const counts=record?.providers?.counts;
 return <div className="contact-profile"><div role="status" className="alert alert-secondary"><strong>Personal data erased.</strong> This contact was erased on {new Date(contact.erased_at).toLocaleString()}. Their conversations remain with message content and attachments removed.</div>
  {record&&<Section title="Erasure record" description={`Run ${record.runs} time${record.runs===1?'':'s'}. Counts are what this installation removed; nothing already sent can be recalled.`}>
   <dl className="contact-facts erasure-stores">{STORES.map(([key,label])=><div key={key}><dt>{label}</dt><dd>{record[key]}</dd></div>)}</dl>
   <h3 className="h6 mt-3">Connected providers</h3>
   {record.providers.requests.length===0?<p className="settings-note">No connected provider held this contact’s data.</p>:<>
    <p className="settings-note">{counts.completed} deleted · {counts.pending} waiting · {counts.failed} failed · {counts.unsupported} cannot delete</p>
    <ul className="erasure-providers">{record.providers.requests.map(item=><li key={item.id}><strong>{PROVIDERS[item.store]||item.store}</strong> <span className={`security-badge security-badge--${item.state==='completed'?'succeeded':item.state==='failed'?'failed':'held'}`}>{STATES[item.state]}</span><br/><small>{item.detail}</small></li>)}</ul></>}
  </Section>}
  <details className="mb-4"><summary>Record details</summary><dl className="contact-facts"><div><dt>ID</dt><dd>{contact.id}</dd></div></dl></details></div>;
}
