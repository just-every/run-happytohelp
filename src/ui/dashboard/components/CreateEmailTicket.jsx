import React, {useEffect, useRef, useState} from 'react';
import {Modal} from 'react-bootstrap';
import {nativeRequest} from '../../native/transport';
import EmailSender from '../../native/pages/email/EmailSender';
import EmailRecipients, {emailRecipientsError, parseEmailRecipients} from './EmailRecipients';
import './CreateEmailTicket.css';
import NewTicketConfiguration from './NewTicketConfiguration';
import NewTicketRequester from './NewTicketRequester';
import useNewTicketChoices from './useNewTicketChoices';
import DialogHeader from './DialogHeader';

/** Operator-created email or call; requester and authenticated submitter remain distinct. */
export default function CreateEmailTicket({projectId:initialProjectId, onHide, onCreated}) {
 const [projectId,setProjectId]=useState(initialProjectId),[brands,setBrands]=useState([]),[errorField,setErrorField]=useState('');
 const [draft, setDraft] = useState({kind:'email',requesterEmail:'',requesterName:'',subject:'',content:'',mailboxId:'',fromAddress:'',cc:'',bcc:'',fields:{},formId:''});
 const {mailboxes,options,error:choicesError}=useNewTicketChoices(projectId,draft.requesterId);
 const [error,setError] = useState(''), [busy,setBusy] = useState(false);
 const [preview,setPreview] = useState(null), [results,setResults] = useState(null);
 const intent = useRef(null), [uncertain,setUncertain] = useState(false);
 const change = (key,value) => setDraft(current => ({...current,[key]:value,...(key==='mailboxId'?{fromAddress:''}:key==='formId'?{fields:{}}:key==='kind'?{requesterId:undefined,fields:{},formId:'',groupId:undefined,assigneeId:undefined}:key==='groupId'&&value&&!options?.groups.find(group=>group.id===value)?.members.includes(current.assigneeId===undefined?options.actorId:current.assigneeId)?{assigneeId:null}:{})}));
 useEffect(()=>{
  let active=true;
  nativeRequest('/api/management/projects').then(result=>{if(active)setBrands(result.data);}).catch(failure=>{if(active)setError(failure.message);});
  return ()=>{active=false;};
 },[]);
 useEffect(()=>{if(mailboxes)setDraft(current=>current.mailboxId?current:{...current,mailboxId:mailboxes[0]?.id||''});},[mailboxes]);
 const switchBrand=async value=>{
  if(busy||uncertain)return;
  setBusy(true);setDraft(current=>({...current,requesterId:undefined,requesterEmail:'',requesterName:'',mailboxId:'',fromAddress:'',cc:'',bcc:'',formId:'',fields:{},groupId:undefined,assigneeId:undefined}));setError('');setErrorField('');intent.current=null;
  try{await nativeRequest('/api/identity/switch-project',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId:value})});setProjectId(value);}catch(failure){setError(failure.message);}finally{setBusy(false);}
 };
 const close=async()=>{
  if(busy||uncertain)return;
  try{if(projectId!==initialProjectId)await nativeRequest('/api/identity/switch-project',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId:initialProjectId})});onHide();}catch(failure){setError(failure.message);}
 };
 const submit = async event => {
  event.preventDefault();if(busy)return;setError('');setErrorField('');
  const requesterEmails=[...new Set(parseEmailRecipients(draft.requesterEmail).map(address=>address.toLowerCase()))];
  const invalid = draft.requesterId&&draft.kind==='call'?'':emailRecipientsError(draft.kind==='notice'?requesterEmails:draft.requesterEmail) || (draft.kind==='notice' ? (parseEmailRecipients(draft.requesterEmail).length<2?'Enter at least two requester email addresses.':'') : (parseEmailRecipients(draft.requesterEmail).length !== 1 ? 'Enter one requester email address.' : '')) || (draft.kind === 'email' && (emailRecipientsError(draft.cc) || emailRecipientsError(draft.bcc)));
  if(invalid){setError(invalid);return;}
  setBusy(true);
  try {
   intent.current ||= {...draft,requesterEmail:draft.requesterId&&!draft.requesterEmail?undefined:draft.requesterEmail,formId:draft.formId||undefined,fields:draft.kind==='notice'||!Object.keys(draft.fields).length?undefined:draft.fields,groupId:draft.kind==='notice'?undefined:draft.groupId,assigneeId:draft.kind==='notice'?undefined:draft.assigneeId,localId:crypto.randomUUID(),
    kind:draft.kind==='notice'?'email':draft.kind,
    ...(draft.kind==='notice'?{requesters:requesterEmails,requesterEmail:undefined,requesterName:undefined}:{}),
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
   setError(failure.message);setErrorField(failure.data?.field||'');
   if(failure.data?.field)setTimeout(()=>document.getElementById(`new-ticket-field-${failure.data.field}`)?.focus(),0);
   // The durable refusal fence guarantees no ticket was created, including
   // recovery after a lost response. Every other unknown keeps its exact command.
   if(failure.data?.code!=='notice_not_created' && (preview || !failure.status || failure.status >= 500))setUncertain(true);
   else {intent.current=null;setPreview(null);setResults(null);setUncertain(false);}
  } finally {setBusy(false);}
 };
 const input = (key,label,type='text',required=false) => <div className="form-group"><label className="form-label" htmlFor={`new-ticket-${key}`}>{label}</label><input className="form-control" id={`new-ticket-${key}`} type={type} required={required} value={draft[key]} disabled={!!draft.requesterId&&['requesterEmail','requesterName'].includes(key)} onChange={event=>change(key,event.target.value)} maxLength={key==='subject'?500:key==='requesterEmail'&&draft.kind==='notice'?16000:320}/></div>;
 return <Modal show onHide={close} className="create-email-ticket" backdrop="static" aria-labelledby="new-ticket-title">
  <DialogHeader closeButton={!busy&&!uncertain}><Modal.Title id="new-ticket-title">New ticket</Modal.Title></DialogHeader>
  <form onSubmit={submit}>
   <Modal.Body>
    {choicesError&&<p className="alert alert-danger" role="alert">{choicesError}</p>}
    {error && <p className="alert alert-danger" role="alert">{error}</p>}
    {uncertain && <p className="alert alert-warning" role="status">Some tickets are unfinished or their result is unknown. Continue this same request before creating another ticket.</p>}
    <fieldset hidden={!!preview} disabled={busy||uncertain||!!preview}>
     <div className="form-group"><label className="form-label" htmlFor="new-ticket-brand">Brand workspace</label><select id="new-ticket-brand" className="form-select" value={projectId} onChange={event=>switchBrand(event.target.value)}>{!brands.some(brand=>brand.id===projectId)&&<option value={projectId}>Current workspace</option>}{brands.map(brand=><option key={brand.id} value={brand.id}>{brand.name}</option>)}</select><p className="form-text">Choose a workspace where you can create tickets. Changing brand clears requester and configuration choices.</p></div>
     <div className="form-group"><label className="form-label" htmlFor="new-ticket-kind">Ticket type</label><select id="new-ticket-kind" className="form-select" value={draft.kind} onChange={event=>change('kind',event.target.value)}><option value="email">Email requester</option><option value="call">Log a call</option><option value="notice">Service notice to several requesters</option></select></div>
     {draft.kind!=='notice'&&<NewTicketRequester key={projectId} projectId={projectId} requesterId={draft.requesterId} onSelect={row=>setDraft(current=>({...current,requesterId:row?.id,requesterEmail:row?.email||'',requesterName:row?.name||'',fields:{}}))}/>}
     <div className="settings-grid">{input('requesterEmail',draft.kind==='notice'?'Requester emails':'Requester email',draft.kind==='notice'?'text':'email',true)}{draft.kind!=='notice'&&input('requesterName','Requester name')}</div>
     <p className="settings-note">You are recorded as the submitter. The requester is the customer this ticket is for.</p>
     {draft.kind !== 'call' && <><EmailSender mailboxes={mailboxes||[]} mailboxId={draft.mailboxId} fromAddress={draft.fromAddress} onChange={patch=>setDraft(current=>({...current,...patch}))}/>{mailboxes===null&&<p role="status">Loading mailboxes…</p>}{draft.kind==='email'&&<EmailRecipients cc={draft.cc} bcc={draft.bcc} onChange={change}/>}</>}
     {draft.kind!=='notice'&&<NewTicketConfiguration {...{draft,options,change,errorField,error}}/>}
     {input('subject','Subject','text',true)}
     <div className="form-group"><label className="form-label" htmlFor="new-ticket-content">{draft.kind==='call'?'Call notes':'Message'}</label><textarea id="new-ticket-content" className="form-control" rows={7} value={draft.content} required onChange={event=>change('content',event.target.value)}/></div>
     {draft.kind==='call' && <p className="settings-note">Call notes are private. This action sends no email.</p>}
    </fieldset>
    {draft.kind==='notice'&&!preview&&<p>Separate email addresses with commas. Review every recipient before sending one ticket per requester. Existing email notice preferences apply.</p>}
    {preview&&!results&&<section aria-label="Notice recipients"><h3>Review recipients</h3><p><strong>{draft.subject}</strong></p><p className="notice-preview-message">{draft.content}</p><ul>{preview.recipients.map(address=><li key={address}>{address}</li>)}</ul><p>Each requester gets a separate ticket and one email attempt. Workspace rate limits apply; refused notices remain visible on their tickets and are never retried automatically.</p></section>}
    {results&&<section aria-label="Notice results"><h3>Notice tickets</h3><p>Open each ticket to check its email outcome.</p><ul>{results.map(row=><li key={row.recipient}>{row.conversation?<a href={`/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(row.conversation.id)}`}>{row.recipient}</a>:row.recipient}{row.error&&<span role="alert"> — {row.error}</span>}</li>)}</ul></section>}

   </Modal.Body>
   <Modal.Footer>{preview&&!results&&!uncertain&&<button className="btn btn-white" type="button" disabled={busy} onClick={()=>{setPreview(null);intent.current=null;}}>Edit notice</button>}<button className="btn btn-white" type="button" disabled={busy||uncertain} onClick={close}>{results?'Close':'Cancel'}</button>{(!results||uncertain)&&<button className="btn btn-primary" type="submit" disabled={busy || (!uncertain&&(!options||!!choicesError)) || (!uncertain && draft.kind!=='call' && !draft.mailboxId)}>{busy?'Creating…':uncertain?'Check same request':draft.kind==='call'?'Log call':draft.kind==='notice'?(preview?'Confirm and email':'Preview recipients'):'Create and email'}</button>}</Modal.Footer>
  </form>
 </Modal>;
}
