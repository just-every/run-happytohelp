import React,{useEffect,useState} from 'react';
import {nativeRequest} from '../../ui/native/transport';
export default function TicketChannel({projectId,conversationId,refreshKey}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[version,setVersion]=useState(0);
 useEffect(()=>{let active=true;setData(null);setError('');nativeRequest(`/api/support-channels/projects/${projectId}/conversations/${conversationId}`).then(r=>{if(active)setData(r.data);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[projectId,conversationId,refreshKey,version]);
 return <div>{error&&<p role="alert">{error}</p>}{data&&<><p>Original channel: <strong>{data.provider}</strong> · {data.channel}</p>{data.blocked&&<p role="status" className="alert alert-warning">{data.blocked.replaceAll('_',' ')}</p>}<p>Public replies use this channel. Internal notes stay private. Unknown sends are never replayed automatically.</p>{data.sends.map(s=><p key={s.message_id}>Channel send: {s.state}{s.error_code&&` · ${s.error_code.replaceAll('_',' ')}`}</p>)}</>}<button className="btn btn-sm btn-outline-secondary" onClick={()=>setVersion(v=>v+1)}>Refresh channel status</button></div>;
}
