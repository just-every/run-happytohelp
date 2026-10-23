import React,{useEffect,useState} from 'react';
import './connections/connections.css';
import {nativeRequest} from '../transport';
import Tokens from './connections/Tokens';
import Destinations from './connections/Destinations';
import Deliveries from './connections/Deliveries';
export default function Connections({projectId,section,role}){
 const kind=section==='api-settings'?'tokens':section==='webhook-settings'?'webhooks':section==='slack-settings'?'slack':'deliveries',root=`/api/management/projects/${projectId}/connections`;
 const [rows,setRows]=useState([]),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const allowed=['owner','admin'].includes(role);
 const load=async()=>{setError('');try{const result=await nativeRequest(root+'/'+kind);setRows(result.data);}catch(e){setError(e.message);}};
 useEffect(()=>{setRows([]);setError('');setNotice('');if(allowed)load();},[root,kind,allowed]);
 const act=async(path,method,body,onSaved)=>{if(busy)return;setBusy(true);setError('');setNotice('');try{const result=await nativeRequest(root+path,{method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});onSaved?.(result);setNotice(path.endsWith('/test')?'Test recorded. Check the delivery log for its outcome.':path.endsWith('/resend')?'Resend queued. Refresh the log to see its outcome.':'Saved.');await load();return result;}catch(e){await load();setError(e.message);}finally{setBusy(false);}};
 if(!allowed)return <p role="alert">Only workspace owners and admins can manage connections.</p>;
 return <div className="workspace-settings connections-page" aria-busy={busy} style={{maxWidth:800,overflowWrap:'anywhere'}}>{error&&<p className="alert alert-danger" role="alert">{error}</p>}{notice&&<p className="alert alert-info" role="status">{notice}</p>}{kind==='tokens'?<Tokens rows={rows} act={act} origin={window.location.origin}/>:kind==='deliveries'?<Deliveries rows={rows} act={act} load={load} busy={busy}/>:<Destinations key={kind} kind={kind} rows={rows} act={act} projectId={projectId}/>}</div>;
}
