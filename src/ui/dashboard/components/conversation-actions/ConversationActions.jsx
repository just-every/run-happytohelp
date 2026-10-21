import React,{useEffect,useState} from 'react';
import {Alert,Button} from 'react-bootstrap';
import Api from '../../api';
import {useCan} from '../ConversationAccess';
import MergedConversationHistory,{useMergedHistory} from './MergedConversationHistory';

/**
 * Ticket › Merges and partner threads: merge history with Undo, private partner threads with Revoke, and the merged
 * tickets' transcripts in a dialog. Merge ticket… and Forward to partner… start from the "+" menu.
 * `onBadge` reports how many merges, partner threads and merged transcripts the ticket has.
 */
export default function ConversationActions({conversation,onChanged,refreshKey,reads,onBadge}) {
    const [history,setHistory]=useState([]),[partners,setPartners]=useState(null),[error,setError]=useState(''),[transcripts,setTranscripts]=useState(false);
    const canManage=useCan(conversation.project_id,'conversations.manage'),canReply=useCan(conversation.project_id,'conversations.reply'),writable=!conversation.merged_into;
    const base=`/projects/${encodeURIComponent(conversation.project_id)}/conversations/${encodeURIComponent(conversation.id)}`;
    const merged=useMergedHistory(conversation,`${reads}:${conversation.ticket_version}`);
    const refresh=async()=>{const [merges,threads]=await Promise.all([Api.get(`${base}/merges`),Api.get(`${base}/partner-forwards`)]);setHistory(merges.data);setPartners(threads.data)};
    useEffect(()=>{let active=true;Promise.all([Api.get(`${base}/merges`),Api.get(`${base}/partner-forwards`)]).then(([merges,threads])=>{if(active){setHistory(merges.data);setPartners(threads.data)}}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[base,refreshKey,reads]);
    const forwards=partners?.forwards||[];
    const count=history.length+forwards.length+merged.sources.length;
    useEffect(()=>{onBadge?.(count)},[count,onBadge]);
    const changed=async result=>{await refresh();await onChanged?.(result)};
    const undo=async merge=>{setError('');try{await changed((await Api.create(`/projects/${encodeURIComponent(conversation.project_id)}/conversations/${encodeURIComponent(merge.target_id)}/merges/${encodeURIComponent(merge.id)}/undo`,{})).data)}catch(e){setError(e.message)}};
    const revoke=async forward=>{setError('');try{await Api.remove(`/projects/${encodeURIComponent(conversation.project_id)}/conversations/${encodeURIComponent(forward.conversation_id)}/partner-forwards/${encodeURIComponent(forward.id)}`);await refresh()}catch(e){setError(e.message)}};
    return <div className="conversation-actions">
        {error&&<Alert variant="danger" role="alert">{error}</Alert>}
        {!count&&partners&&<p className="conversation-details-empty">No merges or partner threads yet. Merge ticket… and Forward to partner… are in the “+” menu.</p>}
        {history.length>0&&<section aria-label="Merge history"><h4 className="ticket-panel-subheading">Merge history</h4>{history.map(merge=><div key={merge.id} className="mt-2"><a href={`/conversations/${encodeURIComponent(merge.source_id)}`}>{merge.source_id}</a> → <a href={`/conversations/${encodeURIComponent(merge.target_id)}`}>{merge.target_id}</a>{merge.undone_at?' · Undone':canManage?<Button size="sm" variant="link" onClick={()=>undo(merge)}>Undo merge</Button>:' · Merged alias'}</div>)}</section>}
        {merged.error&&<p role="alert" className="text-danger">Couldn’t load merged history: {merged.error}</p>}
        {merged.sources.length>0&&<p><Button size="sm" variant="white" aria-haspopup="dialog" onClick={()=>setTranscripts(true)}>Merged ticket histories ({merged.sources.length})</Button></p>}
        {forwards.length>0&&<section aria-label="Private partner threads"><h4 className="ticket-panel-subheading">Private partner threads</h4>{forwards.map(forward=><section key={forward.id} className="mt-3"><strong>External partner: {forward.recipient||'Erased recipient'}</strong><p>{forward.subject} · {forward.state}</p><pre className="text-wrap">{forward.content}</pre>{writable&&canReply&&!forward.revoked_at&&<Button size="sm" variant="outline-secondary" onClick={()=>revoke(forward)}>Revoke partner replies</Button>}{partners.replies.filter(reply=>reply.forward_id===forward.id).map(reply=><div key={reply.id} className="mt-2"><strong>External partner reply · Private</strong><p className="text-break">{reply.content}</p>{partners.files.filter(file=>file.reply_id===reply.id).map(file=><a className="d-block" key={file.id} href={`/api/dashboard/projects/${encodeURIComponent(conversation.project_id)}/conversations/${encodeURIComponent(file.conversation_id)}/partner-files/${encodeURIComponent(file.id)}`}>{file.filename}</a>)}</div>)}</section>)}</section>}
        {transcripts&&<MergedConversationHistory conversation={conversation} history={merged} onHide={()=>setTranscripts(false)}/>}
    </div>;
}
