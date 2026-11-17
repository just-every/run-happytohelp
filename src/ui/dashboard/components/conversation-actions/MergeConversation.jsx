import React, {useState} from 'react';
import {useNavigate} from '@tanstack/react-router';
import {Alert,Button,Form,Modal} from 'react-bootstrap';
import Api from '../../api';
import DialogHeader from '../DialogHeader';

const title=ticket=>ticket.subject||'Untitled ticket';
export default function MergeConversation({conversation,onHide,onChanged}) {
    const navigate=useNavigate();
    const [query,setQuery]=useState(''),[results,setResults]=useState(null),[searched,setSearched]=useState(''),[offset,setOffset]=useState(0),[more,setMore]=useState(false),[selected,setSelected]=useState(null),[survivor,setSurvivor]=useState(conversation.id),[preview,setPreview]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
    const project=`/projects/${encodeURIComponent(conversation.project_id)}`;
    const ticketBase=id=>`${project}/conversations/${encodeURIComponent(id)}`;
    const run=async action=>{setBusy(true);setError('');try{await action()}catch(e){setError(e.message||'The merge could not be completed.')}finally{setBusy(false)}};
    const search=(page=0)=>run(async()=>{
        const term=query.trim(),response=await Api.get(`${project}/ticket-merge-search`,{q:term,exclude:conversation.id,offset:page});
        setResults(response.data);setSearched(term);setOffset(page);setMore(response.has_more);
    });
    const inspect=()=>run(async()=>{
        const source=survivor===conversation.id?selected.id:conversation.id;
        const sourceTicket=await Api.get(`${ticketBase(source)}/ticket`);
        const targetTicket=await Api.get(`${ticketBase(survivor)}/ticket`);
        const response=await Api.create(`${ticketBase(survivor)}/merge/preview`,{source_id:source,source_version:sourceTicket.data.ticket_version,target_version:targetTicket.data.ticket_version});
        setPreview(response.data);
    });
    const apply=()=>run(async()=>{
        const result=await Api.create(`${ticketBase(preview.target_id)}/merge`,preview);
        await onChanged?.(result.data);onHide();
        if(preview.target_id!==conversation.id)await navigate({to:`${project}/conversations/${preview.target_id}`});
    });
    return <Modal show onHide={busy?undefined:onHide} aria-labelledby="merge-ticket-title">
        <DialogHeader closeButton={!busy}><Modal.Title id="merge-ticket-title">Merge duplicate tickets</Modal.Title></DialogHeader>
        <Modal.Body>
            {error&&<Alert variant="danger" role="alert">{error}</Alert>}
            <p>Choose the other ticket and which thread survives. The source becomes an alias with its history, files and private notes preserved.</p>
            <form onSubmit={event=>{event.preventDefault();if(query.trim())search()}}>
                <Form.Group controlId="merge-ticket-search"><Form.Label>Requester or ticket subject</Form.Label><Form.Control maxLength={200} value={query} disabled={busy} onChange={e=>{setQuery(e.target.value);setResults(null)}}/></Form.Group>
                <Button type="submit" variant="secondary" className="mt-2" disabled={busy||!query.trim()}>Search tickets</Button>
            </form>
            {results&&<fieldset className="mt-3"><legend className="h4">Matching tickets</legend>{!results.length&&<p role="status">No matching tickets. Try another requester name, email or subject.</p>}{results.map(ticket=><Form.Check key={ticket.id} id={`merge-ticket-${ticket.id}`} type="radio" name="merge-ticket" checked={selected?.id===ticket.id} disabled={busy} onChange={()=>{setSelected(ticket);setSurvivor(conversation.id);setPreview(null)}} label={<><strong>{title(ticket)}</strong><br/>{ticket.requester_name||ticket.requester_email||'Requester unavailable'}{ticket.requester_name&&ticket.requester_email?` (${ticket.requester_email})`:''} · {ticket.status_category}</>}/>)}{(more||offset>0)&&<div className="d-flex gap-2 mt-2"><Button variant="secondary" disabled={busy||!offset||searched!==query.trim()} onClick={()=>search(Math.max(0,offset-30))}>Previous tickets</Button><Button variant="secondary" disabled={busy||!more||searched!==query.trim()} onClick={()=>search(offset+30)}>Next tickets</Button></div>}</fieldset>}
            {selected&&<div className="mt-3"><p>Selected ticket: <strong>{title(selected)}</strong></p><Form.Group controlId="merge-surviving-ticket"><Form.Label>Surviving ticket</Form.Label><Form.Select disabled={busy} value={survivor} onChange={e=>{setSurvivor(e.target.value);setPreview(null)}}><option value={conversation.id}>This ticket: {title(conversation)}</option><option value={selected.id}>Selected ticket: {title(selected)}</option></Form.Select></Form.Group></div>}
            {preview&&<div className="mt-3">
                {preview.tickets.map(ticket=><p key={ticket.id}><strong>{ticket.id===preview.target_id?'Surviving':'Source'}: {ticket.id}</strong><br/>{ticket.messages} messages · {ticket.attachments} attachments · {ticket.private_notes} private notes<br/>Customer: {ticket.customer_name||ticket.customer_email||ticket.contact_id}{ticket.customer_name&&ticket.customer_email?` (${ticket.customer_email})`:''} · Channel: {ticket.channel} · Status: {ticket.status_category}</p>)}
                <p>{preview.private_notes}</p><p>{preview.channel_restrictions}</p><p>{preview.outcome_treatment}</p>
                <p>No customer notification is sent. Undo is available until a ticket changes or a partner thread advances.</p>
            </div>}
        </Modal.Body>
        <Modal.Footer><Button variant="secondary" disabled={busy} onClick={onHide}>Cancel</Button>{preview?<Button disabled={busy} onClick={apply}>Confirm merge</Button>:<Button disabled={busy||!selected} onClick={inspect}>Preview merge</Button>}</Modal.Footer>
    </Modal>;
}
