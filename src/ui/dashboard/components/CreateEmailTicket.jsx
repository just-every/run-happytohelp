import React,{useEffect,useRef,useState} from 'react';
import {Modal} from 'react-bootstrap';
import {nativeRequest} from '../../native/transport';
import {useDashboardSettings} from '../../native/dashboard-state';
import IconHint from '../../native/IconHint';
import EmailSender from '../../native/pages/email/EmailSender';
import EmailRecipients,{emailRecipientsError,parseEmailRecipients} from './EmailRecipients';
import TicketRequesterPicker from './TicketRequesterPicker';
import CreateTicketConfiguration,{activeTicketFields} from './CreateTicketConfiguration';
import './CreateEmailTicket.css';

export default function CreateEmailTicket({projectId,onHide,onCreated}){
 const workspace=useDashboardSettings(),[draft,setDraft]=useState({kind:'email',requesterId:'',requesterEmail:'',requesterName:'',subject:'',content:'',mailboxId:'',fromAddress:'',cc:'',bcc:'',brandId:projectId,formId:'',groupId:'',assigneeId:'',fields:{},internal:false});
 const [mailboxes,setMailboxes]=useState(null),[settings,setSettings]=useState(null),[forms,setForms]=useState([]),[selected,setSelected]=useState([]),[preview,setPreview]=useState(null),[outcomes,setOutcomes]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false);
 const intent=useRef(null),base=`/api/dashboard/projects/${encodeURIComponent(projectId)}`,bulk=draft.kind==='service',email=draft.kind==='email'||bulk;
 const change=(key,value)=>{setPreview(null);setOutcomes(null);intent.current=null;setDraft(current=>({...current,[key]:value,...(key==='mailboxId'?{fromAddress:''}:key==='kind'?{internal:false}:{})}));};
 useEffect(()=>{const controller=new AbortController();Promise.all([nativeRequest(`/api/management/projects/${encodeURIComponent(projectId)}/mailboxes`,{signal:controller.signal}),nativeRequest(base+'/ticket-settings',{signal:controller.signal}),nativeRequest(`/api/forms/projects/${encodeURIComponent(projectId)}/forms`,{signal:controller.signal})]).then(([mailboxes,tickets,forms])=>{const rows=mailboxes.data.filter(row=>row.status==='connected');setMailboxes(rows);setSettings(tickets.data);setForms(forms.data);setDraft(current=>({...current,mailboxId:rows[0]?.id||''}));}).catch(failure=>{if(!controller.signal.aborted)setError(failure.message);});return()=>controller.abort();},[base,projectId]);
 const configuration=()=>{const visible=new Set(activeTicketFields(settings,forms,draft).map(field=>field.id));return {brandId:draft.brandId,formId:draft.formId||null,groupId:draft.groupId||null,...(draft.assigneeId?{assigneeId:draft.assigneeId==='unassigned'?null:draft.assigneeId}:{}),fields:Object.fromEntries(Object.entries(draft.fields).filter(([id,value])=>visible.has(id)&&value!==''&&value!==undefined)),...(draft.kind==='walk_in'?{channel:'walk_in'}:{}),internal:!email||draft.internal&&!bulk};};
 const submit=async event=>{
  event.preventDefault();if(busy)return;setError('');
  if(!bulk&&!draft.requesterId){const invalid=emailRecipientsError(draft.requesterEmail)||(parseEmailRecipients(draft.requesterEmail).length!==1?'Enter one requester email address.':'');if(invalid){setError(invalid);return;}}
  if(bulk&&!selected.length){setError('Select one to ten existing requesters.');return;}
  if(email&&!bulk&&!draft.internal){const invalid=emailRecipientsError(draft.cc)||emailRecipientsError(draft.bcc);if(invalid){setError(invalid);return;}}
  setBusy(true);
  try{
   const ticket={kind:email?'email':'call',subject:draft.subject,content:draft.content,mailboxId:email?draft.mailboxId:undefined,fromAddress:email&&draft.fromAddress?draft.fromAddress:undefined,configuration:configuration()};
   if(bulk){
    if(!preview){intent.current||={localId:crypto.randomUUID(),purpose:'service',requesterIds:selected,ticket};const result=await nativeRequest(base+'/service-notices/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(intent.current)});setPreview(result.data);}
    else{const result=await nativeRequest(`${base}/service-notices/${encodeURIComponent(preview.id)}/apply`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});setOutcomes(result.data.results);}
    setUncertain(false);
   }else{
    intent.current||={...ticket,localId:crypto.randomUUID(),...(draft.requesterId?{requesterId:draft.requesterId}:{requesterEmail:draft.requesterEmail,requesterName:draft.requesterName}),cc:email&&!draft.internal?parseEmailRecipients(draft.cc):[],bcc:email&&!draft.internal?parseEmailRecipients(draft.bcc):[]};
    const result=await nativeRequest(base+'/tickets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(intent.current)});setUncertain(false);onCreated?.(result.conversation,result);onHide();
   }
  }catch(failure){setError(failure.message);if(!failure.status||failure.status>=500)setUncertain(true);else{if(!preview)intent.current=null;setUncertain(false);}}finally{setBusy(false);}
 };
 const input=(key,label,type='text',required=false)=><div className="form-group"><label className="form-label" htmlFor={`new-ticket-${key}`}>{label}</label><input className="form-control" id={`new-ticket-${key}`} type={type} required={required} value={draft[key]} onChange={event=>{change(key,event.target.value);if(key==='requesterEmail')setDraft(current=>({...current,requesterId:''}));}} maxLength={key==='subject'?500:320}/></div>;
 const selectedIds=bulk?selected:draft.requesterId?[draft.requesterId]:[],agents=workspace.projects?.[projectId]?.agents||[];
 return <Modal show onHide={()=>!busy&&!uncertain&&onHide()} className="create-email-ticket" backdrop="static"><Modal.Header><Modal.Title>{bulk?'Service notice':'New ticket'}</Modal.Title><IconHint label="Close dialog"><button type="button" className="btn-close" aria-label="Close dialog" disabled={busy||uncertain} onClick={onHide}/></IconHint></Modal.Header><form onSubmit={submit}><Modal.Body>
  {error&&<p className="alert alert-danger" role="alert">{error}</p>}{uncertain&&<p className="alert alert-warning" role="status">The result is unknown. Check this same request before creating another ticket.</p>}
  <fieldset disabled={busy||uncertain||!!outcomes}><div className="form-group"><label className="form-label" htmlFor="new-ticket-kind">Ticket type</label><select id="new-ticket-kind" className="form-select" value={draft.kind} onChange={event=>change('kind',event.target.value)}><option value="email">Email requester</option><option value="call">Log a call</option><option value="walk_in">Log a walk-in</option><option value="service">Service notice to several requesters</option></select></div>
   <TicketRequesterPicker projectId={projectId} selected={selectedIds} multiple={bulk} onSelect={(row,checked)=>{setPreview(null);intent.current=null;if(bulk){if(checked&&selected.length>=10){setError('Select at most ten requesters.');return;}setSelected(current=>checked?[...current,row.id]:current.filter(id=>id!==row.id));}else setDraft(current=>({...current,requesterId:row.id,requesterEmail:row.email||'',requesterName:row.name||''}));}}/>
   {!bulk&&<div className="settings-grid">{input('requesterEmail','Requester email','email',!draft.requesterId)}{input('requesterName','Requester name')}</div>}
   <p className="settings-note">You are recorded as the submitter. {bulk?'Service notices concern existing support requests, never marketing. Only customers who explicitly enabled update emails may receive them.':'The customer is the requester. Choose an existing contact or enter a new email address.'}</p>
   {email&&<><EmailSender mailboxes={mailboxes||[]} mailboxId={draft.mailboxId} fromAddress={draft.fromAddress} onChange={patch=>{setPreview(null);intent.current=null;setDraft(current=>({...current,...patch}));}}/>{mailboxes===null&&<p role="status">Loading mailboxes…</p>}{!bulk&&<><label className="form-check"><input type="checkbox" className="form-check-input" checked={draft.internal} onChange={event=>change('internal',event.target.checked)}/><span className="form-check-label">Internal first comment (no email)</span></label>{!draft.internal&&<EmailRecipients cc={draft.cc} bcc={draft.bcc} onChange={change}/>}</>}</>}
   <CreateTicketConfiguration {...{settings,forms,agents,draft,change}}/>{input('subject','Subject','text',true)}<div className="form-group"><label className="form-label" htmlFor="new-ticket-content">{email&&!draft.internal?'Message':'Private notes'}</label><textarea id="new-ticket-content" className="form-control" rows={5} value={draft.content} maxLength={100000} required onChange={event=>change('content',event.target.value)}/></div>{(!email||draft.internal&&!bulk)&&<p className="settings-note">These notes are private. This action sends no email.</p>}
  </fieldset>
  {preview&&<section aria-label="Service notice preview"><h3>Review service notice</h3><p>{preview.ticket.subject}</p><p className="ticket-notice-message">{preview.ticket.content}</p><ul>{preview.recipients.map(row=><li key={row.id}>{row.name||row.email}: {row.status==='ready'?'Ready':row.reason}</li>)}</ul><p>One ticket per eligible requester. Delivery outcomes are recorded separately.</p></section>}
  {outcomes&&<section aria-label="Service notice outcomes" role="status"><h3>Delivery outcomes</h3><ul>{outcomes.map(row=><li key={row.requesterId}>{preview.recipients.find(recipient=>recipient.id===row.requesterId)?.email}: {row.state}{row.reason?` — ${row.reason}`:''}{row.ticketId&&<> · <a href={`/projects/${projectId}/conversations/${row.ticketId}`}>Open ticket</a></>}</li>)}</ul></section>}
 </Modal.Body><Modal.Footer><button className="btn btn-white" type="button" disabled={busy||uncertain} onClick={onHide}>{outcomes?'Close':'Cancel'}</button><button className="btn btn-primary" type="submit" disabled={busy||!settings||(!uncertain&&email&&!draft.internal&&!draft.mailboxId)}>{busy?'Working…':uncertain?'Check same request':bulk?outcomes?'Refresh outcomes':preview?'Confirm service notice':'Preview service notice':email&&!draft.internal?'Create and email':'Create internal ticket'}</button></Modal.Footer></form></Modal>;
}
