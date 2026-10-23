import { useDashboardLocation } from '../dashboard-state';
import { useUnsavedChanges } from '../NavigationGuard';
import { useNavigate } from '@tanstack/react-router';
import { Link } from '@tanstack/react-router';
import React, { useEffect, useState } from 'react';
import { nativeRequest } from '../transport';
import { Field, Section, Feedback } from './forms';
import { AdminRecords, AdminRecordDetails } from './AdminRecords';
import { PageHeaderActions } from '../PageHeader';
import { tooltip } from '../../../modules/tooltip/tooltip';

export default function AdminPage() {
 const {markDirty,markSaved}=useUnsavedChanges();

 const navigate=useNavigate(); const routeLocation=useDashboardLocation();

    const [,section='projects',recordId]=routeLocation.pathname.split('/').filter(Boolean);
    const path=`/api/management/admin/${section}`;
    const [items,setItems]=useState(null),[draft,setDraft]=useState(null),[error,setError]=useState(''),[saved,setSaved]=useState(false),[query,setQuery]=useState('');
    const load=async()=>{setError('');try{if(recordId&&recordId!=='create'){const result=await nativeRequest(`${path}/${recordId}`);setDraft(result.data);}else{const result=await nativeRequest(path+`?q=${encodeURIComponent(query)}`);setItems(result.data);}}catch(e){setError(e.message);}};
    useEffect(()=>{setDraft(null);setItems(null);setSaved(false);load();if(recordId==='create')setDraft({});},[path,recordId]);
    const change=(name,value)=>{markDirty();setDraft(d=>({...d,[name]:value}));};
    const action=async kind=>{setError('');try{await nativeRequest(`${path}/${draft.id}${kind==='delete'?'':`/${kind}`}`,{method:kind==='delete'?'DELETE':'PUT'});if(kind==='delete')await navigate({to:`/admin/${section}`});else await load();}catch(e){setError(e.message);}};
    const save=async e=>{e.preventDefault();setError('');try{await nativeRequest(path+(draft.id?`/${draft.id}`:''),{method:draft.id?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(draft)});markSaved();setSaved(true);await load();}catch(e){setError(e.message);}};
    return <><Feedback {...{error,saved}}/>{!draft?<><div className="card"><div className="card-header workspace-filter-bar"><form onSubmit={e=>{e.preventDefault();load();}}><div className="input-group workspace-search"><input id="admin-search" type="search" className="form-control list-search" aria-label="Search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search"/><button className="input-group-text" {...tooltip('Search')}><i className="fe fe-search" aria-hidden="true"/></button></div></form></div><AdminRecords section={section} items={items}/></div>{['ai_defaults','leads'].includes(section)&&<PageHeaderActions><Link className="btn btn-primary" to={`/admin/${section}/create`}>Add {section==='leads'?'lead':'AI default'}</Link></PageHeaderActions>}</>:<div className="workspace-settings"><form onSubmit={save}><Section title={draft.name||draft.role||section}>{section==='ai_defaults'?<><Field name="role" label="Role" required value={draft.role} onChange={change}/><Field name="prompt" label="Prompt" type="textarea" required value={draft.prompt} onChange={change}/></>:section==='leads'?<>{['website','email','name','subject','source','status'].map(name=><Field key={name} name={name} label={name[0].toUpperCase()+name.slice(1)} value={draft[name]} onChange={change}/>)}<Field name="content" label="Content" type="textarea" value={draft.content} onChange={change}/></>:<AdminRecordDetails record={draft}/>}</Section>{['ai_defaults','leads'].includes(section)&&<button className="btn btn-primary">Save</button>}</form>{section==='leads'&&draft.id&&<div className="settings-actions mt-3"><button className="btn btn-white" onClick={()=>action('process')}>Process lead</button><button className="btn btn-primary" disabled={draft.status!=='reviewed'} onClick={()=>action('send')}>Send reviewed draft</button><button className="btn btn-outline-danger" onClick={()=>action('delete')}>Delete</button></div>}</div>}</>;
}
