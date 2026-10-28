import React,{useEffect,useState} from 'react';
import {nativeRequest} from '../../native/transport';
export default function NewTicketRequester({projectId,requesterId,onSelect}) {
 const [query,setQuery]=useState(''),[rows,setRows]=useState([]),[error,setError]=useState('');
 useEffect(()=>{
  let active=true;const controller=new AbortController();setRows([]);setError('');
  const timer=setTimeout(()=>{if(query.trim())nativeRequest(`/api/dashboard/projects/${encodeURIComponent(projectId)}/tickets/requesters?q=${encodeURIComponent(query)}`,{signal:controller.signal}).then(result=>{if(active)setRows(result.data);}).catch(failure=>{if(active)setError(failure.message);});},200);
  return ()=>{active=false;controller.abort();clearTimeout(timer);};
 },[projectId,query]);
 return <div className="form-group"><label className="form-label" htmlFor="new-ticket-search">Find requester by name, email or phone</label><input id="new-ticket-search" className="form-control" value={query} onChange={event=>setQuery(event.target.value)} maxLength={320}/>{error&&<p role="alert">{error}</p>}{rows.length>0&&<ul className="list-unstyled">{rows.map(row=><li key={row.id}><button type="button" className="btn btn-white" onClick={()=>{onSelect(row);setQuery('');}}>{row.name||row.email||row.phone} {row.email}</button></li>)}</ul>}{query&&!rows.length&&<p className="form-text">No matching requester shown. Enter their email below to create a new contact.</p>}{requesterId&&<button type="button" className="btn btn-white" onClick={()=>onSelect(null)}>Use a different requester</button>}</div>;
}
