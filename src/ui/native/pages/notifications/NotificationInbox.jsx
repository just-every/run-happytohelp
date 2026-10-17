import React,{useEffect,useState} from 'react';
import {Link} from '@tanstack/react-router';
import {nativeRequest} from '../../transport';
import {Section,Feedback} from '../forms';
export default function NotificationInbox({projectId}){
 const path=`/api/management/projects/${projectId}/notification-inbox`,[rows,setRows]=useState(null),[error,setError]=useState('');
 useEffect(()=>{nativeRequest(path).then(r=>setRows(r.data)).catch(e=>setError(e.message));},[path]);
 const read=async id=>{try{await nativeRequest(`${path}/${encodeURIComponent(id)}/read`,{method:'PUT'});setRows(rows=>rows.map(row=>row.id===id?{...row,read_at:Date.now()}:row));}catch(e){setError(e.message);}};
 return <Section title="Your ticket notifications"><Feedback error={error}/>{rows?.length===0?<p>No ticket notifications yet.</p>:<ul>{rows?.map(row=><li key={row.id} className="mb-3"><Link to={`/projects/${projectId}/conversations/${row.conversation_id}`}>{row.label}</Link>{' '}{!row.read_at&&<button className="btn btn-link" type="button" onClick={()=>read(row.id)}>Mark read</button>}</li>)}</ul>}</Section>;
}
