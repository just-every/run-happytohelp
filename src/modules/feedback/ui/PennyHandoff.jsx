import React,{useState} from 'react';
import {nativeRequest} from '../../../ui/native/transport';
import {Field,Feedback} from '../../../ui/native/pages/forms';
export default function PennyHandoff({path,source,messages,onChanged}){
 const [preview,setPreview]=useState(null),[consent,setConsent]=useState(''),[approve,setApprove]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const base=path+`/sources/${source.id}`;
 const run=async work=>{setBusy(true);setError('');try{await work()}catch(e){setError(e.message)}finally{setBusy(false)}};
 if(source.handoff_state)return <p role="status">Penny handoff: {source.handoff_state==='accepted'?'accepted by Penny; requester closure stays in Penny':source.handoff_state+'. Check Penny before any further action; this source is never replayed.'}</p>;
 return <div className="feedback-handoff"><Feedback error={error}/><button className="btn btn-sm btn-white" type="button" disabled={busy} onClick={()=>run(async()=>{const result=await nativeRequest(base+'/handoff-preview');setPreview({...result.data,preview_hash:result.preview_hash});setApprove(false)})}>Preview Penny handoff</button>
 {preview&&<><p>Only this selected context will be shared. Your requester’s email, internal notes and files are excluded.</p><blockquote>{preview.source}</blockquote><p>Requester: {preview.contact?.displayName||'Previously linked Penny requester'}</p><p><a href={preview.sourceUrl}>Original support conversation</a></p>
  <Field name={`penny-consent-${source.id}`} label="Requester sharing permission" value={consent} options={[{value:'',label:'Choose the requester’s permission'},...messages.map(m=>({value:m.id,label:m.content?.slice(0,110)||'Customer message'}))]} onChange={(_,value)=>setConsent(value)}/>
  <Field name={`penny-approve-${source.id}`} label="I reviewed this context and the requester's permission to share it with Penny." type="checkbox" value={approve} onChange={(_,value)=>setApprove(value)}/>
  <button type="button" className="btn btn-primary" disabled={busy||!approve||!consent} onClick={()=>run(async()=>{await nativeRequest(base+'/handoff',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({approve:true,sharing_message_id:consent,preview_hash:preview.preview_hash})});setPreview(null);await onChanged()})}>Approve and hand off to Penny</button>
 </>}
 </div>;
}
