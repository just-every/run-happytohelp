import React,{useCallback,useEffect,useId,useState} from 'react';
import {Modal} from 'react-bootstrap';
import {nativeRequest} from '../../../native/transport';
import ConversationBody from '../ConversationBody';

/** The merged tickets' own transcripts, read for Ticket › Merges and partner threads (which shows how many). */
export function useMergedHistory(conversation,refreshKey){
 const [sources,setSources]=useState([]),[error,setError]=useState(''),[page,setPage]=useState(1),[more,setMore]=useState(false),[busy,setBusy]=useState(false);
 const path=`/api/dashboard/projects/${encodeURIComponent(conversation.project_id)}/conversations/${encodeURIComponent(conversation.id)}/merged-history`;
 const read=useCallback(async page=>{const result=await nativeRequest(`${path}?page=${page}`);return result.data.filter(source=>source.conversation_id!==conversation.id)},[path,conversation.id]);
 useEffect(()=>{let active=true;setError('');setPage(1);setSources([]);read(1).then(data=>{if(active){setSources(data);setMore(data.some(source=>source.buckets.length===10))}}).catch(failure=>{if(active)setError(failure.message)});return()=>{active=false}},[read,refreshKey]);
 const older=async()=>{setBusy(true);setError('');try{const data=await read(page+1);setSources(current=>current.map(source=>{const previous=data.find(row=>row.conversation_id===source.conversation_id);return {...source,buckets:[...(previous?.buckets||[]),...source.buckets]}}));setPage(page+1);setMore(data.some(source=>source.buckets.length===10))}catch(failure){setError(failure.message)}finally{setBusy(false)}};
 return {sources,error,more,busy,older};
}

/** An operator-only transcript view in a dialog; original source media keep their own URLs. */
export default function MergedConversationHistory({conversation,history,onHide}){
 const titleId=useId();
 return <Modal show size="lg" onHide={onHide} aria-labelledby={titleId} className="merged-history-dialog">
  <Modal.Header closeButton><Modal.Title id={titleId}>Merged ticket histories</Modal.Title></Modal.Header>
  <Modal.Body>
   {history.error&&<p role="alert" className="text-danger">Couldn’t load merged history: {history.error}</p>}
   {history.sources.map(source=><details key={source.conversation_id} className="mb-3"><summary>{source.subject||`Ticket ${source.conversation_id}`} · <a href={source.source_link}>Source ticket</a></summary><ConversationBody conversation={{...conversation,id:source.conversation_id}} buckets={source.buckets} setAtTop={()=>{}}/></details>)}
   {history.more&&<button type="button" className="btn btn-sm btn-white" disabled={history.busy} onClick={history.older}>{history.busy?'Loading…':'Load older merged history'}</button>}
  </Modal.Body>
 </Modal>;
}
