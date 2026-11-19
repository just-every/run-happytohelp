import React, {useEffect, useState} from 'react';
import {Link, useRouter} from '@tanstack/react-router';
import {nativeRequest} from '../transport';

/** A placeholder account name must be replaced before the owner installs chat. */
export default function CustomerNameStep({projectId,children}) {
 const [name,setName]=useState(''),[ready,setReady]=useState(false),[needsName,setNeedsName]=useState(false),[placeholder,setPlaceholder]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const router=useRouter();
 const path=`/api/management/projects/${projectId}/widget-owner-name`;
 useEffect(()=>{let active=true;nativeRequest(path).then(result=>{if(!active)return;const actual=result.name?.trim()||'';const missing=!actual||actual.toLowerCase()==='owner';setName(missing?'':actual);setPlaceholder(missing);setNeedsName(!result.confirmed);setReady(true);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[path]);
 const save=async event=>{event.preventDefault();event.stopPropagation();setError('');setBusy(true);try{await nativeRequest(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name.trim()})});setNeedsName(false);await router.invalidate();}catch(e){setError(e.message);}finally{setBusy(false);}};
 if(!ready)return <p role={error?'alert':'status'}>{error||'Loading your name…'}</p>;
 if(!needsName)return children;
 // This block may be inside the widget settings form, so it uses its own button rather than a nested form.
 return <><section className="settings-section"><h2>What should customers call you?</h2><label htmlFor="customer-display-name" className="form-label">Your name</label><input id="customer-display-name" className="form-control" value={name} onChange={e=>{e.stopPropagation();setName(e.target.value);}} autoComplete="name" maxLength={200} onKeyDown={e=>{if(e.key==='Enter'&&name.trim()&&name.trim().toLowerCase()!=='owner')save(e);}}/><p>You can add a photo in <Link to="/users/profile">your profile</Link>.</p>{error&&<p role="alert">{error}</p>}<button type="button" className="btn btn-primary" disabled={busy||!name.trim()||name.trim().toLowerCase()==='owner'} onClick={save}>{busy?'Saving…':'Save and continue'}</button></section>{!placeholder&&children}</>;
}
