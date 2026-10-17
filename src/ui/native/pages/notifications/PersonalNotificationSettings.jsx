import React,{useEffect,useState} from 'react';
import {nativeRequest} from '../../transport';
import {Section,Feedback} from '../forms';
import {useUnsavedChanges} from '../../NavigationGuard';
const labels={assignment:'Assigned to you',customer_updated:'Customer updates on your assigned tickets',group:'Unassigned tickets in your groups',follower:'Tickets you follow',mention:'Mentions'};
export default function PersonalNotificationSettings({projectId}){
 const path=`/api/management/projects/${projectId}/notification-preferences`,[rows,setRows]=useState(null),[error,setError]=useState(''),[saved,setSaved]=useState(false),[busy,setBusy]=useState(false);
 const {markDirty,markSaved}=useUnsavedChanges();
 useEffect(()=>{nativeRequest(path).then(r=>setRows(r.data)).catch(e=>setError(e.message));},[path]);
 const change=(kind,key,value)=>{markDirty();setSaved(false);setRows(rows=>rows.map(row=>row.kind===kind?{...row,[key]:value}:row));};
 const save=async()=>{setBusy(true);setError('');try{await nativeRequest(path,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({preferences:rows})});markSaved();setSaved(true);}catch(e){setError(e.message);}finally{setBusy(false);}};
 return <Section title="Ticket notifications" description="Choose how this workspace notifies you. Notices require your current access to the ticket."><Feedback {...{error,saved}}/>{rows?.map(row=><fieldset key={row.kind} className="mb-3"><legend className="h6">{labels[row.kind]}</legend>{['inbox','email'].map(channel=><label key={channel} className="form-check"><input className="form-check-input" type="checkbox" checked={!!row[channel]} onChange={e=>change(row.kind,channel,e.target.checked)}/><span className="form-check-label">{channel==='inbox'?'Inbox':'Email'}</span></label>)}</fieldset>)}{rows&&<button type="button" className="btn btn-primary" disabled={busy} onClick={save}>{busy?'Saving…':'Save ticket preferences'}</button>}</Section>;
}
