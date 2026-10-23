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
  const invalid = emailRecipientsError(draft.requesterEmail) || (parseEmailRecipients(draft.requesterEmail).length !== 1 ? 'Enter one requester email address.' : '') || (draft.kind === 'email' && (emailRecipientsError(draft.cc) || emailRecipientsError(draft.bcc)));
  if(invalid){setError(invalid);return;}
  setBusy(true);
  try {
   intent.current ||= {...draft,localId:crypto.randomUUID(),
    fromAddress:draft.kind==='email'&&draft.fromAddress?draft.fromAddress:undefined,
    cc:draft.kind==='email'?parseEmailRecipients(draft.cc):[],
    bcc:draft.kind==='email'?parseEmailRecipients(draft.bcc):[]};
   const result = await nativeRequest(`/api/dashboard/projects/${encodeURIComponent(projectId)}/tickets`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(intent.current)});
   setUncertain(false);onCreated?.(result.conversation,result);onHide();
  } catch(failure) {
   setError(failure.message);
   // A missing response retains the exact command; checking cannot create another ticket.
   if(!failure.status || failure.status >= 500)setUncertain(true);
   else {intent.current=null;setUncertain(false);}
  } finally {setBusy(false);}
 };
 const input = (key,label,type='text',required=false) => <div className="form-group"><label className="form-label" htmlFor={`new-ticket-${key}`}>{label}</label><input className="form-control" id={`new-ticket-${key}`} type={type} required={required} value={draft[key]} onChange={event=>change(key,event.target.value)} maxLength={key==='subject'?998:320}/></div>;
 return <Modal show onHide={()=>!busy&&!uncertain&&onHide()} className="create-email-ticket" backdrop="static">
  <DialogHeader closeButton={!busy&&!uncertain}><Modal.Title>New ticket</Modal.Title></DialogHeader>
  <form onSubmit={submit}>
   <Modal.Body>
    {error && <p className="alert alert-danger" role="alert">{error}</p>}
    {uncertain && <p className="alert alert-warning" role="status">The result is unknown. Check this same request before creating another ticket.</p>}
    <fieldset disabled={busy||uncertain}>
     <div className="form-group"><label className="form-label" htmlFor="new-ticket-kind">Ticket type</label><select id="new-ticket-kind" className="form-select" value={draft.kind} onChange={event=>change('kind',event.target.value)}><option value="email">Email requester</option><option value="call">Log a call</option></select></div>
     <div className="settings-grid">{input('requesterEmail','Requester email','email',true)}{input('requesterName','Requester name')}</div>
     <p className="settings-note">You are recorded as the submitter. The requester is the customer this ticket is for.</p>
     {draft.kind === 'email' && <><EmailSender mailboxes={mailboxes||[]} mailboxId={draft.mailboxId} fromAddress={draft.fromAddress} onChange={patch=>setDraft(current=>({...current,...patch}))}/>{mailboxes===null&&<p role="status">Loading mailboxes…</p>}<EmailRecipients cc={draft.cc} bcc={draft.bcc} onChange={change}/></>}
     {input('subject','Subject','text',true)}
     <div className="form-group"><label className="form-label" htmlFor="new-ticket-content">{draft.kind==='call'?'Call notes':'Message'}</label><textarea id="new-ticket-content" className="form-control" rows={7} value={draft.content} required onChange={event=>change('content',event.target.value)}/></div>
     {draft.kind==='call' && <p className="settings-note">Call notes are private. This action sends no email.</p>}
    </fieldset>
   </Modal.Body>
   <Modal.Footer><button className="btn btn-white" type="button" disabled={busy||uncertain} onClick={onHide}>Cancel</button><button className="btn btn-primary" type="submit" disabled={busy || (!uncertain && draft.kind==='email' && !draft.mailboxId)}>{busy?'Creating…':uncertain?'Check same request':draft.kind==='call'?'Log call':'Create and email'}</button></Modal.Footer>
  </form>
 </Modal>;
}
