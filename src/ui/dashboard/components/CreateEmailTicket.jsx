import React, {useEffect, useRef, useState} from 'react';
import {Modal} from 'react-bootstrap';
import {nativeRequest} from '../../native/transport';
import EmailSender from '../../native/pages/email/EmailSender';
import EmailRecipients, {emailRecipientsError, parseEmailRecipients} from './EmailRecipients';
import './CreateEmailTicket.css';
import DialogHeader from './DialogHeader';

/** Operator-created email or call; requester and authenticated submitter remain distinct. */
export default function CreateEmailTicket({projectId, onHide, onCreated}) {
 const [draft, setDraft] = useState({kind:'email',requesterEmail:'',requesterName:'',subject:'',content:'',mailboxId:'',fromAddress:'',cc:'',bcc:''});
 const [mailboxes, setMailboxes] = useState(null), [error,setError] = useState(''), [busy,setBusy] = useState(false);
 const [preview,setPreview] = useState(null), [results,setResults] = useState(null);
 const intent = useRef(null), [uncertain,setUncertain] = useState(false);
 const change = (key,value) => setDraft(current => ({...current,[key]:value,...(key==='mailboxId'?{fromAddress:''}:{})}));
 useEffect(() => {
  const controller = new AbortController();
  nativeRequest(`/api/management/projects/${encodeURIComponent(projectId)}/mailboxes`,{signal:controller.signal}).then(result => {
   const rows = result.data.filter(row => row.status === 'connected');
   setMailboxes(rows);setDraft(current => ({...current,mailboxId:rows[0]?.id || ''}));
  }).catch(failure => {if(!controller.signal.aborted)setError(failure.message);});
  return () => controller.abort();
 },[projectId]);
 const submit = async event => {
  event.preventDefault();if(busy)return;setError('');
  const invalid = emailRecipientsError(draft.requesterEmail) || (draft.kind==='notice' ? (parseEmailRecipients(draft.requesterEmail).length<2?'Enter at least two requester email addresses.':'') : (parseEmailRecipients(draft.requesterEmail).length !== 1 ? 'Enter one requester email address.' : '')) || (draft.kind === 'email' && (emailRecipientsError(draft.cc) || emailRecipientsError(draft.bcc)));
  if(invalid){setError(invalid);return;}
  setBusy(true);
  try {
   intent.current ||= {...draft,localId:crypto.randomUUID(),
    kind:draft.kind==='notice'?'email':draft.kind,
    ...(draft.kind==='notice'?{requesters:parseEmailRecipients(draft.requesterEmail),requesterEmail:undefined,requesterName:undefined}:{}),
    fromAddress:draft.kind!=='call'&&draft.fromAddress?draft.fromAddress:undefined,
    cc:draft.kind==='email'?parseEmailRecipients(draft.cc):[],
    bcc:draft.kind==='email'?parseEmailRecipients(draft.bcc):[]};
   if(draft.kind==='notice'){
    const path=`/api/dashboard/projects/${encodeURIComponent(projectId)}/tickets/notices`;
    if(!preview){
     const reviewed=await nativeRequest(path+'/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(intent.current)});
     setPreview(reviewed);setUncertain(false);
    }else{
     const sent=await nativeRequest(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...intent.current,confirmation:preview.confirmation})});
     setResults(sent.results);setUncertain(sent.results.some(row=>!row.accepted));
    }
    return;
   }
   const result = await nativeRequest(`/api/dashboard/projects/${encodeURIComponent(projectId)}/tickets`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(intent.current)});
   setUncertain(false);onCreated?.(result.conversation,result);onHide();
  } catch(failure) {
   setError(failure.message);
   // Once a batch was confirmed, even a later refusal may follow a lost partial
   // response. Retain its exact identity instead of creating a new batch on retry.
   if(preview || !failure.status || failure.status >= 500)setUncertain(true);
   else {intent.current=null;setPreview(null);setUncertain(false);}
  } finally {setBusy(false);}
 };
 const input = (key,label,type='text',required=false) => <div className="form-group"><label className="form-label" htmlFor={`new-ticket-${key}`}>{label}</label><input className="form-control" id={`new-ticket-${key}`} type={type} required={required} value={draft[key]} onChange={event=>change(key,event.target.value)} maxLength={key==='subject'?500:key==='requesterEmail'&&draft.kind==='notice'?16000:320}/></div>;
 return <Modal show onHide={()=>!busy&&!uncertain&&onHide()} className="create-email-ticket" backdrop="static" aria-labelledby="new-ticket-title">
  <DialogHeader closeButton={!busy&&!uncertain}><Modal.Title id="new-ticket-title">New ticket</Modal.Title></DialogHeader>
  <form onSubmit={submit}>
   <Modal.Body>
    {error && <p className="alert alert-danger" role="alert">{error}</p>}
    {uncertain && <p className="alert alert-warning" role="status">The result is unknown. Check this same request before creating another ticket.</p>}
    <fieldset hidden={!!preview} disabled={busy||uncertain||!!preview}>
     <div className="form-group"><label className="form-label" htmlFor="new-ticket-kind">Ticket type</label><select id="new-ticket-kind" className="form-select" value={draft.kind} onChange={event=>change('kind',event.target.value)}><option value="email">Email requester</option><option value="call">Log a call</option><option value="notice">Service notice to several requesters</option></select></div>
     <div className="settings-grid">{input('requesterEmail',draft.kind==='notice'?'Requester emails':'Requester email',draft.kind==='notice'?'text':'email',true)}{draft.kind!=='notice'&&input('requesterName','Requester name')}</div>
     <p className="settings-note">You are recorded as the submitter. The requester is the customer this ticket is for.</p>
     {draft.kind !== 'call' && <><EmailSender mailboxes={mailboxes||[]} mailboxId={draft.mailboxId} fromAddress={draft.fromAddress} onChange={patch=>setDraft(current=>({...current,...patch}))}/>{mailboxes===null&&<p role="status">Loading mailboxes…</p>}{draft.kind==='email'&&<EmailRecipients cc={draft.cc} bcc={draft.bcc} onChange={change}/>}</>}
     {input('subject','Subject','text',true)}
     <div className="form-group"><label className="form-label" htmlFor="new-ticket-content">{draft.kind==='call'?'Call notes':'Message'}</label><textarea id="new-ticket-content" className="form-control" rows={7} value={draft.content} required onChange={event=>change('content',event.target.value)}/></div>
     {draft.kind==='call' && <p className="settings-note">Call notes are private. This action sends no email.</p>}
    </fieldset>
    {draft.kind==='notice'&&!preview&&<p>Separate email addresses with commas. Review every recipient before sending one ticket per requester. Existing email notice preferences apply.</p>}
    {preview&&!results&&<section aria-label="Notice recipients"><h3>Review recipients</h3><p><strong>{draft.subject}</strong></p><p className="notice-preview-message">{draft.content}</p><ul>{preview.recipients.map(address=><li key={address}>{address}</li>)}</ul><p>Each requester gets a separate ticket and one email attempt. Workspace rate limits apply; refused notices remain visible on their tickets and are never retried automatically.</p></section>}
    {results&&<section aria-label="Notice results"><h3>Notice tickets</h3><p>Open each ticket to check its email outcome.</p><ul>{results.map(row=><li key={row.recipient}>{row.conversation?<a href={`/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(row.conversation.id)}`}>{row.recipient}</a>:row.recipient}{row.error&&<span role="alert"> — {row.error}</span>}</li>)}</ul></section>}

   </Modal.Body>
   <Modal.Footer>{preview&&!results&&!uncertain&&<button className="btn btn-white" type="button" disabled={busy} onClick={()=>{setPreview(null);intent.current=null;}}>Edit notice</button>}<button className="btn btn-white" type="button" disabled={busy||uncertain} onClick={onHide}>{results?'Close':'Cancel'}</button>{(!results||uncertain)&&<button className="btn btn-primary" type="submit" disabled={busy || (!uncertain && draft.kind!=='call' && !draft.mailboxId)}>{busy?'Creating…':uncertain?'Check same request':draft.kind==='call'?'Log call':draft.kind==='notice'?(preview?'Confirm and email':'Preview recipients'):'Create and email'}</button>}</Modal.Footer>
  </form>
 </Modal>;
}
