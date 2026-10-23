import React,{useState} from 'react';
import {Alert,Button,Form,Modal} from 'react-bootstrap';
import Api from '../../api';
import DialogHeader from '../DialogHeader';

export default function ForwardConversation({conversation,messages=[],onHide,onChanged}) {
    const [recipient,setRecipient]=useState(''),[subject,setSubject]=useState(conversation.subject||'Support question'),[note,setNote]=useState(''),[selected,setSelected]=useState([]),[preview,setPreview]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[command]=useState(()=>crypto.randomUUID());
    const base=`/projects/${encodeURIComponent(conversation.project_id)}/conversations/${encodeURIComponent(conversation.id)}/partner-forwards`;
    const visible=messages.filter(message=>['contact','operator','owner','admin','ai'].includes(message.actor_role)&&!message.erased_at);
    const edit=setter=>e=>{setter(e.target.value);setPreview(null)};
    const run=async action=>{setBusy(true);setError('');try{await action()}catch(e){setError(e.message||'The partner forward could not be completed.')}finally{setBusy(false)}};
    const inspect=()=>run(async()=>setPreview((await Api.create(`${base}/preview`,{recipient,message_ids:selected})).data));
    const send=()=>run(async()=>{const response=await Api.create(base,{recipient,subject,note,message_ids:selected,expected_version:preview.expected_version,idempotencyKey:command});await onChanged?.(response.data);onHide()});
    return <Modal show size="lg" onHide={busy?undefined:onHide}>
        <DialogHeader closeButton={!busy}><Modal.Title>Forward to an external partner</Modal.Title></DialogHeader>
        <Modal.Body>
            {error&&<Alert variant="danger" role="alert">{error}</Alert>}
            <p>Select customer-visible messages to share. Partner replies stay private to your team.</p>
            <Form.Group controlId="partner-recipient"><Form.Label>Partner email</Form.Label><Form.Control type="email" value={recipient} disabled={busy} onChange={edit(setRecipient)}/></Form.Group>
            <Form.Group controlId="partner-subject" className="mt-2"><Form.Label>Subject</Form.Label><Form.Control value={subject} maxLength={500} disabled={busy} onChange={edit(setSubject)}/></Form.Group>
            <Form.Group controlId="partner-note" className="mt-2"><Form.Label>Message to partner</Form.Label><Form.Control as="textarea" rows={3} value={note} maxLength={10000} disabled={busy} onChange={edit(setNote)}/></Form.Group>
            <fieldset className="mt-3" disabled={busy}><legend className="h6">Messages to share</legend>{visible.map(message=><Form.Check key={message.id} id={`forward-${message.id}`} label={message.content||'Message with attachment'} checked={selected.includes(message.id)} onChange={e=>{setSelected(old=>e.target.checked?[...old,message.id]:old.filter(id=>id!==message.id));setPreview(null)}}/>)}</fieldset>
            {preview&&<Alert variant="info" className="mt-3"><p>To: {preview.recipient}</p><p>Customer: {preview.customer_identity?.name||preview.customer_identity?.email||preview.customer_identity?.id} · Source channel: {preview.channel}</p><p>{preview.messages.length} messages and {preview.attachments.length} attachments will be shared. Private notes are excluded. The customer receives no notification.</p>{preview.attachments.map(file=><div key={file.id}>{file.filename}</div>)}<p className="mb-0">Replies from this external participant are private. They do not receive customer history or become a teammate.</p></Alert>}
        </Modal.Body>
        <Modal.Footer><Button variant="secondary" disabled={busy} onClick={onHide}>Cancel</Button>{preview?<Button disabled={busy} onClick={send}>Send selected content</Button>:<Button disabled={busy||!recipient||!selected.length} onClick={inspect}>Preview forward</Button>}</Modal.Footer>
    </Modal>;
}
