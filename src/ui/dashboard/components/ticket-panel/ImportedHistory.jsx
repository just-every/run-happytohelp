import React,{useState} from 'react';
import {nativeRequest} from '../../../native/transport';

/** Uses the existing native ticket door. Source events are inert private data,
 * not live policy, compliance calculations or links to a vendor account. */
export default function ImportedHistory({conversation}){
 const [data,setData]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[page,setPage]=useState(0);
 const load=async()=>{setBusy(true);setError('');try{setData(await nativeRequest(`/api/conversations/${encodeURIComponent(conversation.id)}/imported-history`))}catch(e){setError(e.message)}finally{setBusy(false)}};
 return <details className="import-source-note imported-history" onToggle={e=>{if(e.currentTarget.open&&!data&&!busy&&!error)load()}}>
  <summary>Imported status and SLA history</summary>
  <p>Source history only. No native clock, alert or policy is activated. Missing history cannot establish compliance.</p>
  {busy&&<p role="status">Loading imported history…</p>}
  {error&&<><p role="alert">{error}</p><button type="button" className="btn btn-sm btn-white" onClick={load}>Retry history</button></>}
  {data&&<><p>Metric file: {data.history.metrics}. Audit file: {data.history.audits}. {data.history.events.length} events.</p>
   {data.history.provenance?.length>0&&<details><summary>Original file locations</summary><ul>{data.history.provenance.map((source,index)=><li key={index} className="text-break">{source.file}, row {source.row}, {source.pointer||'/'}<br/>SHA-256: {source.sha256}</li>)}</ul></details>}
   <ol>{data.history.events.slice(page*10,page*10+10).map(e=><li className="text-break" key={`${e.kind}/${e.id}`}>
    <b>{e.type}</b> — {e.metric||e.field||'unsupported meaning'}{!e.understood&&' (unsupported meaning)'}<br/>
    Ticket {e.ticket_id}; {e.kind} event {e.id}{e.audit_id&&`; audit ${e.audit_id}`}{e.instance_id&&`; instance ${e.instance_id}`}<br/>
    <time dateTime={e.time}>{e.time}</time>
    {e.deleted===true&&<p>Source event marked deleted.</p>}
    {e.author_id&&<p>Source author: {e.author_id}</p>}
    {e.previous!==undefined&&<p>From: {JSON.stringify(e.previous)} → {JSON.stringify(e.value)}</p>}
    {e.sla!==undefined&&<p className="text-break">Source target: {JSON.stringify(e.sla)}</p>}
    {e.elapsed!==undefined&&<p className="text-break">Source elapsed units: {JSON.stringify(e.elapsed)}</p>}
   </li>)}</ol>
   {data.history.events.length>10&&<div><button type="button" className="btn btn-sm btn-white" disabled={!page} onClick={()=>setPage(page-1)}>Previous events</button> <button type="button" className="btn btn-sm btn-white" disabled={(page+1)*10>=data.history.events.length} onClick={()=>setPage(page+1)}>Next events</button></div>}
  </>}
 </details>;
}
