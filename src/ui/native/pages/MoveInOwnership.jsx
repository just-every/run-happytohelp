import React,{useId,useState} from 'react';
import {nativeRequest} from '../transport';

export default function MoveInOwnership({projectId,runId}){
 const path=`/api/move-in/projects/${projectId}/imports/${runId}/ownership`;
 const controlId=useId();
 const [data,setData]=useState(null),[owners,setOwners]=useState({}),[groups,setGroups]=useState({}),[preview,setPreview]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const load=async()=>{setBusy(true);setError('');try{setData(await nativeRequest(path));setPreview(null)}catch(failure){setError(failure.message)}finally{setBusy(false)}};
 const sourceIds=key=>[...new Set((data?.tickets??[]).map(ticket=>ticket.source[key]).filter(Boolean))];
 const select=(kind,id,value)=>{const set=kind==='owners'?setOwners:setGroups;set(current=>{const next={...current};if(value)Object.defineProperty(next,id,{value,enumerable:true,writable:true,configurable:true});else delete next[id];return next});setPreview(null);setNotice('')};
 const chosen=()=>({owners:Object.fromEntries(sourceIds('ownerId').filter(id=>Object.hasOwn(owners,id)).map(id=>[id,owners[id]])),groups:Object.fromEntries(sourceIds('groupId').filter(id=>Object.hasOwn(groups,id)).map(id=>[id,groups[id]]))});
 const review=async()=>{setBusy(true);setError('');try{setPreview(await nativeRequest(path+'/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(chosen())}))}catch(failure){setError(failure.message)}finally{setBusy(false)}};
 const apply=async()=>{setBusy(true);setError('');try{const result=await nativeRequest(path+'/apply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({bindings:preview.bindings,fingerprint:preview.fingerprint})});setNotice(`${result.applied} assignments applied. ${result.remaining} remain to review.`);await load()}catch(failure){setError(failure.message)}finally{setBusy(false)}};
 return <details onToggle={event=>{if(event.currentTarget.open&&!data&&!busy)load()}} className="move-in-ownership"><summary>Review imported ownership</summary>
  <p>Map source IDs to existing teammates and groups. This separate action assigns unchanged, unassigned tickets, including Closed history. It creates no accounts, sends no messages, and leaves rules inactive.</p>
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {!data?busy&&<p role="status">Loading assignments…</p>:!data.total?<p>No remaining unassigned tickets with a source ownership snapshot.</p>:<>
   <p>{data.tickets.length} of {data.total} assignments on this page.</p>
   <fieldset disabled={busy}>
    {sourceIds('ownerId').map((id,index)=><div className="mb-3" key={'owner-'+id}><label className="form-label" htmlFor={controlId+'-owner-'+index}>Source agent {id}</label><select id={controlId+'-owner-'+index} className="form-select" value={Object.hasOwn(owners,id)?owners[id]:''} onChange={event=>select('owners',id,event.target.value)}><option value="">Leave unassigned</option>{data.owners.map(owner=><option key={owner.id} value={owner.id}>{owner.name}</option>)}</select></div>)}
    {sourceIds('groupId').map((id,index)=><div className="mb-3" key={'group-'+id}><label className="form-label" htmlFor={controlId+'-group-'+index}>Source group {id}</label><select id={controlId+'-group-'+index} className="form-select" value={Object.hasOwn(groups,id)?groups[id]:''} onChange={event=>select('groups',id,event.target.value)}><option value="">Leave unmapped</option>{data.groups.map(group=><option key={group.id} value={group.id}>{group.name}</option>)}</select></div>)}
   </fieldset>
   <button type="button" className="btn btn-white" disabled={busy} onClick={review}>Preview assignments</button>
   {preview&&<><p>{preview.tickets.length} ready · {preview.unmapped} left unmapped on this page.</p><ul>{preview.tickets.map(ticket=><li key={ticket.id}>{ticket.subject||ticket.id} · {data.owners.find(owner=>owner.id===ticket.ownerId)?.name||'No individual owner'} · {data.groups.find(group=>group.id===ticket.groupId)?.name||'No group'} · {ticket.status_category}</li>)}</ul><button type="button" className="btn btn-primary" disabled={busy||!preview.tickets.length} onClick={apply}>Apply assignments</button></>}
  </>}
 </details>;
}
