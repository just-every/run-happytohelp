import React,{useEffect,useState} from 'react';
import {Alert,Button} from 'react-bootstrap';
import Api from '../../api';
import MergeConversation from './MergeConversation';
import ForwardConversation from './ForwardConversation';
import {useCan} from '../ConversationAccess';

/** Add beside the existing conversation menu. Pass already-authorized messages
 * from the current ticket, and reload the ticket from onChanged after writes. */
export default function ConversationActions({conversation,messages,onChanged,refreshKey}) {
    const [modal,setModal]=useState(null),[history,setHistory]=useState([]),[partners,setPartners]=useState(null),[error,setError]=useState('');
    const canManage=useCan(conversation.project_id,'conversations.manage'),canReply=useCan(conversation.project_id,'conversations.reply'),writable=!conversation.merged_into;
    const base=`/projects/${encodeURIComponent(conversation.project_id)}/conversations/${encodeURIComponent(conversation.id)}`;
    const refresh=async()=>{const [merges,threads]=await Promise.all([Api.get(`${base}/merges`),Api.get(`${base}/partner-forwards`)]);setHistory(merges.data);setPartners(threads.data)};
    useEffect(()=>{let active=true;Promise.all([Api.get(`${base}/merges`),Api.get(`${base}/partner-forwards`)]).then(([merges,threads])=>{if(active){setHistory(merges.data);setPartners(threads.data)}}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[base,refreshKey]);
    const changed=async result=>{await refresh();await onChanged?.(result)};
    const undo=async merge=>{setError('');try{await changed((await Api.create(`/projects/${encodeURIComponent(conversation.project_id)}/conversations/${encodeURIComponent(merge.target_id)}/merges/${encodeURIComponent(merge.id)}/undo`,{})).data)}catch(e){setError(e.message)}};
    const revoke=async forward=>{setError('');try{await Api.remove(`/projects/${encodeURIComponent(conversation.project_id)}/conversations/${encodeURIComponent(forward.conversation_id)}/partner-forwards/${encodeURIComponent(forward.id)}`);await refresh()}catch(e){setError(e.message)}};
    return <div className="conversation-actions">
        {error&&<Alert variant="danger" role="alert">{error}</Alert>}
        {writable&&(canManage||canReply)&&<div className="d-flex gap-2">{canManage&&<Button size="sm" variant="outline-secondary" onClick={()=>setModal('merge')}>Merge ticket</Button>}{canReply&&<Button size="sm" variant="outline-secondary" onClick={()=>setModal('forward')}>Forward to partner</Button>}</div>}
        {history.length>0&&<details className="mt-2"><summary>Merge history</summary>{history.map(merge=><div key={merge.id} className="mt-2"><a href={`/conversations/${encodeURIComponent(merge.source_id)}`}>{merge.source_id}</a> → <a href={`/conversations/${encodeURIComponent(merge.target_id)}`}>{merge.target_id}</a>{merge.undone_at?' · Undone':canManage?<Button size="sm" variant="link" onClick={()=>undo(merge)}>Undo merge</Button>:' · Merged alias'}</div>)}</details>}
        {partners?.forwards.length>0&&<details className="mt-2"><summary>Private partner threads</summary>{partners.forwards.map(forward=><section key={forward.id} className="mt-3"><strong>External partner: {forward.recipient||'Erased recipient'}</strong><p>{forward.subject} · {forward.state}</p><pre className="text-wrap">{forward.content}</pre>{writable&&canReply&&!forward.revoked_at&&<Button size="sm" variant="outline-secondary" onClick={()=>revoke(forward)}>Revoke partner replies</Button>}{partners.replies.filter(reply=>reply.forward_id===forward.id).map(reply=><div key={reply.id} className="mt-2"><strong>External partner reply · Private</strong><p className="text-break">{reply.content}</p>{partners.files.filter(file=>file.reply_id===reply.id).map(file=><a className="d-block" key={file.id} href={`/api/dashboard/projects/${encodeURIComponent(conversation.project_id)}/conversations/${encodeURIComponent(file.conversation_id)}/partner-files/${encodeURIComponent(file.id)}`}>{file.filename}</a>)}</div>)}</section>)}</details>}
        {modal==='merge'&&writable&&canManage&&<MergeConversation conversation={conversation} onHide={()=>setModal(null)} onChanged={changed}/>}
        {modal==='forward'&&writable&&canReply&&<ForwardConversation conversation={conversation} messages={messages} onHide={()=>setModal(null)} onChanged={changed}/>}
    </div>;
}
