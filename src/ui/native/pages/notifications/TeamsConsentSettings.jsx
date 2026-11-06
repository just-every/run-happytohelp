import React,{useCallback,useEffect,useState} from 'react';
import {nativeRequest} from '../../transport';
import {Section,Feedback} from '../forms';
export default function TeamsConsentSettings({projectId}){
 const path=`/api/management/projects/${projectId}/teammate-teams/consent`,[data,setData]=useState(null),[choice,setChoice]=useState(''),[error,setError]=useState(''),[saved,setSaved]=useState(false),[busy,setBusy]=useState(false);
 const load=useCallback(()=>nativeRequest(path).then(setData),[path]);
 useEffect(()=>{load().catch(e=>setError(e.message));},[load]);
 const save=async connection_id=>{setBusy(true);setError('');setSaved(false);try{await nativeRequest(path,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({connection_id})});await load();setSaved(true);}catch(e){setError(e.message);}finally{setBusy(false);}};
 return <Section title="Personal Teams notices" description="Enable personal ticket notices through one existing Teams bot connection. Each teammate must link their own personal chat and choose their notices."><Feedback {...{error,saved}}/>
 {data?.consent?<p data-testid="teams-consent">Enabled on {data.consent.connection_name??'a Teams connection that is no longer available'}. <button type="button" className="btn btn-link" style={{minHeight:44}} disabled={busy} onClick={()=>save(null)}>Turn off personal Teams notices</button></p>
 :data?.destinations.length===0?<p>Add a Teams bot connection under Support channels first.</p>
 :data&&<><label className="form-label" htmlFor="teams-consent-connection">Teams connection</label><select id="teams-consent-connection" className="form-select mb-2" style={{minHeight:44}} value={choice} onChange={e=>setChoice(e.target.value)}><option value="">Choose a connection</option>{data.destinations.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select><button type="button" className="btn btn-outline-secondary" style={{minHeight:44}} disabled={busy||!choice} onClick={()=>save(choice)}>Enable personal Teams notices</button></>}
 </Section>;
}
