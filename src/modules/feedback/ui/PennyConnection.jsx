import React,{useEffect,useState} from 'react';
import {nativeRequest} from '../../../ui/native/transport';
import {Field,Feedback} from '../../../ui/native/pages/forms';
const json=body=>({method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
export default function PennyConnection({base}){
 const path=base+'/penny-connection';
 const [data,setData]=useState(null),[origin,setOrigin]=useState(''),[token,setToken]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const load=async()=>{const result=(await nativeRequest(path)).data;setData(result);setOrigin(result.origin)};
 useEffect(()=>{load().catch(e=>setError(e.message))},[path]);
 const save=async body=>{setBusy(true);setError('');setNotice('');try{await nativeRequest(path,json(body));setToken('');await load();setNotice(body.revoke?'Penny disconnected. Retained source history is unchanged.':'Penny connected. Only an approved source handoff shares data.')}catch(e){setError(e.message)}finally{setBusy(false)}};
 return <details className="feedback-connection"><summary>Penny connection</summary><p>Connect your own Penny installation with a scoped API key granting votes:write. Aggregation, priority, roadmap and requester closure stay in Penny.</p><Feedback error={error}/>{notice&&<p role="status">{notice}</p>}{data&&<p>{data.connected?'Penny connected.':'Penny is not connected.'}</p>}
  <form onSubmit={event=>{event.preventDefault();save({origin,token})}}><fieldset disabled={busy}><legend className="visually-hidden">Connect Penny</legend><Field name="penny-origin" label="Penny installation origin" type="url" value={origin} onChange={(_,value)=>setOrigin(value)} required hint="Use the public HTTPS origin, with no path."/><Field name="penny-token" label="Penny API key" type="password" value={token} onChange={(_,value)=>setToken(value)} required/><button className="btn btn-white">Save Penny connection</button></fieldset></form>
  {data?.connected&&<button type="button" className="btn btn-white" disabled={busy} onClick={()=>save({revoke:true})}>Disconnect Penny</button>}
 </details>;
}
