import React,{useCallback,useEffect,useState} from 'react';
import {nativeRequest} from '../../transport';
import {Section,Feedback} from '../forms';
/** Owner or admin consent for personal Slack notices on one existing bot-mode Slack connection. */
export default function SlackConsentSettings({projectId}){
 const path=`/api/management/projects/${projectId}/teammate-slack/consent`,[data,setData]=useState(null),[choice,setChoice]=useState(''),[error,setError]=useState(''),[saved,setSaved]=useState(false),[busy,setBusy]=useState(false);
 const load=useCallback(()=>nativeRequest(path).then(setData).catch(e=>setError(e.message)),[path]);
 useEffect(()=>{load();},[load]);
 const save=async destination_id=>{setBusy(true);setError('');setSaved(false);try{await nativeRequest(path,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({destination_id})});await load();setSaved(true);}catch(e){setError(e.message);}finally{setBusy(false);}};
 if(!data)return <Feedback error={error}/>;
 return <Section title="Personal Slack notices" description="Let teammates link their own Slack member and receive ticket notices as direct messages through one Slack bot connection. Off until you enable it."><Feedback {...{error,saved}}/>
 {data.consent?<p data-testid="slack-consent">Enabled on {data.consent.destination_name??'a Slack connection that is no longer available'}. <button type="button" className="btn btn-link" disabled={busy} onClick={()=>save(null)}>Turn off</button></p>
 :data.destinations.length===0?<p>Add a Slack bot connection under Connections first.</p>
 :<><label className="form-label" htmlFor="slack-consent-destination">Slack connection</label><select id="slack-consent-destination" className="form-select mb-2" value={choice} onChange={e=>setChoice(e.target.value)}><option value="">Choose a connection</option>{data.destinations.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select><button type="button" className="btn btn-outline-secondary" disabled={busy||!choice} onClick={()=>save(choice)}>Enable personal Slack notices</button></>}
 </Section>;
}
