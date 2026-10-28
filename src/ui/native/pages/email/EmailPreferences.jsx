import React,{useCallback,useRef,useState} from 'react';
import {useUnsavedChanges} from '../../NavigationGuard';
import {nativeRequest} from '../../transport';
import {Field} from '../forms';
import EmailSettings from '../EmailSettings';

/** Saves field changes in order; no refresh replaces a draft or remounts the page.
 * Address edits keep the existing one-step confirmation. Failed writes retain
 * their values and the navigation guard until Retry succeeds. */
export default function EmailPreferences({initial,status:initialStatus,role,projectId}){
 const [data,setData]=useState(initial),[status,setStatus]=useState(initialStatus),[state,setState]=useState(''),[error,setError]=useState('');
 const {markDirty,markSaved}=useUnsavedChanges(),latest=useRef(initial),approved=useRef(initial),pending=useRef(0),chain=useRef(Promise.resolve());
 const path=`/api/management/projects/${projectId}/email-settings`;
 const refresh=useCallback(async()=>{const result=await nativeRequest(path);if(result.managed?.address&&result.data){const changed=latest.current.email_from_address!==result.data.from_address;latest.current={...latest.current,email_from_address:result.data.from_address,inbound_address:result.data.inbound_address,...(changed?{is_enabled:result.data.is_enabled}:{})};approved.current={...approved.current,email_from_address:result.data.from_address,inbound_address:result.data.inbound_address};setData(latest.current);}setStatus({managed:result.managed,sending:result.sending,receiving:result.receiving,installation:result.installation});},[path]);
 const save=value=>{
  const revision=++pending.current;markDirty();setState('Saving…');setError('');
  chain.current=chain.current.catch(()=>{}).then(async()=>{
   await nativeRequest(path,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
   if(revision===pending.current){setState('Saved');if(['email_from_address','inbound_address'].every(key=>latest.current[key]===approved.current[key]))markSaved();await refresh();}
  }).catch(()=>{if(revision===pending.current){setState('');setError('Your changes could not be saved. They are kept here.');}});
 };
 const change=(key,value)=>{const next={...latest.current,[key]:value};latest.current=next;setData(next);markDirty();setState('');setError('');if(!['email_from_address','inbound_address'].includes(key))save({...next,email_from_address:approved.current.email_from_address,inbound_address:approved.current.inbound_address});};
 const field=(name,label,type,options)=><div key={name} onBlur={event=>{if(!['email_from_address','inbound_address'].includes(name)||event.currentTarget.contains(event.relatedTarget))return;if(latest.current[name]===approved.current[name])return;if(window.confirm('Use this email address for this workspace?')){approved.current={...approved.current,[name]:latest.current[name]};save({...latest.current,email_from_address:approved.current.email_from_address,inbound_address:approved.current.inbound_address});}else{latest.current={...latest.current,[name]:approved.current[name]};setData(latest.current);}}}><Field {...{name,label,type,options}} value={data[name]} onChange={change}/></div>;
 return <div className="email-preferences"><div aria-live="polite">{state&&<p role="status">{state}</p>}{error&&<p role="alert">{error} <button className="btn btn-link" type="button" onClick={()=>save(latest.current)}>Retry</button></p>}</div><EmailSettings {...{data,status,field,role,projectId}} onRefresh={refresh}/></div>;
}
