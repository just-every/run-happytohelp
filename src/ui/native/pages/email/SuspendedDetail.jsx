import React, {useId, useState} from 'react';
import {Field} from '../forms';
import {readableDate,safeJson} from './mail-api';
import SuspendedAttachments from './SuspendedAttachments';
import {senderDomain} from './SenderRules';

export default function SuspendedDetail({mail,busy,onRecover,onDelete,onRule,path}) {
 const [conversationId,setConversationId]=useState(mail.candidate_conversation_id||''),[asNote,setAsNote]=useState(false),[error,setError]=useState('');const id=useId();
 const domain=senderDomain(mail.from_address);
 const recover=()=>{if(!conversationId.trim()&&!asNote){setError('Choose private operator note to create a new ticket, or enter an existing target conversation ID.');return;}setError('');onRecover(mail,{conversationId:conversationId.trim(),asNote});};
 const show = value => typeof safeJson(value)==='string'?safeJson(value):JSON.stringify(safeJson(value),null,2);
 return <article className="email-suspended-detail" aria-label="Suspended email details">
  <h2>{mail.subject||'(No subject)'}</h2>
  <dl className="email-facts"><div><dt>From</dt><dd>{mail.from_address}</dd></div><div><dt>Received</dt><dd>{readableDate(mail.created_at)}</dd></div><div><dt>Expires</dt><dd>{readableDate(mail.expires_at)}</dd></div><div><dt>Reason</dt><dd>{mail.reason?.replaceAll('_',' ')}</dd></div></dl>
  <details><summary>Recipients</summary><pre className="email-safe-preview">{show(mail.to_json)}</pre></details>
  <details open><summary>Authentication</summary><pre className="email-safe-preview">{show(mail.auth_json)||'No authentication evidence recorded.'}</pre></details>
  <details><summary>Headers</summary><pre className="email-safe-preview">{show(mail.headers_json)||'No headers recorded.'}</pre></details>
  <h3 className="h6 mt-4">Plain-text preview</h3><pre className="email-safe-preview">{mail.text||'(No plain-text content)'}</pre><p className="settings-note">Email content is shown as text. Remote images and email HTML are not loaded.</p>
  <SuspendedAttachments path={path} attachments={mail.attachments} disabled={busy}/>
  <fieldset className="email-editor" disabled={busy}><legend>Recover email</legend>
   <Field name={`${id}-target`} label="Target conversation ID (optional)" value={conversationId} onChange={(_,value)=>setConversationId(value)} hint="Enter an existing ticket ID, or leave blank to create a new ticket with a private note. Check the requester and subject before recovering."/>
   <Field name={`${id}-note`} label="Recover as a private operator note" type="checkbox" value={asNote} onChange={(_,value)=>setAsNote(value)}/><p className="settings-note">Use a private note when sender authentication cannot be proven. It is labeled as recovered mail. Recovery sends no acknowledgment and starts no AI reply.</p>
   {error&&<p className="text-danger" role="alert">{error}</p>}
   <div className="email-actions"><button type="button" className="btn btn-primary" onClick={recover}>{conversationId.trim()?'Recover email':'Create a new ticket'}</button><button type="button" className="btn btn-outline-danger" onClick={()=>onDelete(mail)}>Delete email</button></div>
  </fieldset>
  {onRule&&<><div className="email-actions" aria-label="Sender rules"><button type="button" className="btn btn-white" disabled={busy} onClick={()=>onRule(mail.from_address,'allow')}>Allow sender</button><button type="button" className="btn btn-white" disabled={busy} onClick={()=>onRule(mail.from_address,'block')}>Block sender</button><button type="button" className="btn btn-link" disabled={busy} onClick={()=>onRule(mail.from_address,'remove')}>Remove sender rule</button></div>
  {domain&&<div className="email-actions" aria-label="Domain rules"><button type="button" className="btn btn-white" disabled={busy} onClick={()=>onRule(domain,'allow')}>Allow domain {domain}</button><button type="button" className="btn btn-white" disabled={busy} onClick={()=>onRule(domain,'block')}>Block domain {domain}</button><button type="button" className="btn btn-link" disabled={busy} onClick={()=>onRule(domain,'remove')}>Remove domain rule</button></div>}
  <p className="settings-note">Sender rules affect future mail. Allowing a sender does not prove authentication or recover this message.</p></>}
 </article>;
}
