import React,{useEffect,useState} from 'react';
import {nativeRequest} from '../../../native/transport';
import ConversationBody from '../ConversationBody';
/** An operator-only transcript view; original source media keep their own URLs. */
export default function MergedConversationHistory({conversation,refreshKey}){
 const [sources,setSources]=useState([]),[error,setError]=useState(''),[page,setPage]=useState(1),[more,setMore]=useState(false),[busy,setBusy]=useState(false);
 const path=`/api/dashboard/projects/${encodeURIComponent(conversation.project_id)}/conversations/${encodeURIComponent(conversation.id)}/merged-history`;
 const read=async page=>{const result=await nativeRequest(`${path}?page=${page}`);return result.data.filter(source=>source.conversation_id!==conversation.id)};
 useEffect(()=>{let active=true;setError('');setPage(1);setSources([]);read(1).then(data=>{if(active){setSources(data);setMore(data.some(source=>source.buckets.length===10))}}).catch(failure=>{if(active)setError(failure.message)});return()=>{active=false}},[path,refreshKey]);
 const older=async()=>{setBusy(true);setError('');try{const data=await read(page+1);setSources(current=>current.map(source=>{const previous=data.find(row=>row.conversation_id===source.conversation_id);return {...source,buckets:[...(previous?.buckets||[]),...source.buckets]}}));setPage(page+1);setMore(data.some(source=>source.buckets.length===10))}catch(failure){setError(failure.message)}finally{setBusy(false)}};
 return <>{error&&<p role="alert" className="px-3 text-danger">Couldn’t load merged history: {error}</p>}{sources.length>0&&<section className="px-3 py-2" aria-label="Merged ticket histories"><h3 className="h5">Merged ticket histories</h3>{sources.map(source=><details key={source.conversation_id} className="mb-3"><summary>{source.subject||`Ticket ${source.conversation_id}`} · <a href={source.source_link}>Source ticket</a></summary><ConversationBody conversation={{...conversation,id:source.conversation_id}} buckets={source.buckets} setAtTop={()=>{}}/></details>)}{more&&<button className="btn btn-sm btn-white" disabled={busy} onClick={older}>{busy?'Loading…':'Load older merged history'}</button>}</section>}</>;
}
