import { useDashboardLocation, useDashboardSettings } from '../dashboard-state';
import { useUnsavedChanges } from '../NavigationGuard';
import { useNavigate } from '@tanstack/react-router';
import React, {useCallback,useEffect,useRef,useState} from 'react';
import {nativeRequest} from '../transport';
import {Feedback} from './forms';
import ManagementLists from './ManagementLists';
import ManagementEditor from './ManagementEditor';
import {InvitationCreated,InvitationNotice} from './InvitationActions';
import ContactDetails from './ContactDetails';
import ContactErasure,{ContactErased} from './ContactErasure';
import AssistantsPage from './AssistantsPage';
import MacrosPage from './macros/MacrosPage';
import {useConfirmation} from './ConfirmDialog';
import {deleteCopy} from './delete-copy';
import {validateManagementDraft} from './management-validation';
import './management-parity.css';
export default function ManagementPage(props){return props.section==='macros'?<MacrosPage {...props}/>:props.section==='ais'?<AssistantsPage {...props}/>:<ResourcePage key={`${props.projectId}/${props.section}`} {...props}/>}
const parseContact=data=>({...data,...JSON.parse(data.metadata_json||'{}')});
function ResourcePage({projectId,section,recordId}) {
 const {markDirty,markSaved}=useUnsavedChanges();
 const navigate=useNavigate(); const routeLocation=useDashboardLocation(); const {currentAgent}=useDashboardSettings();
 const {ask,dialog}=useConfirmation();
 const path=`/api/management/projects/${projectId}/${section}`,base=`/projects/${projectId}/${section}`;
 const [items,setItems]=useState(null),[draft,setDraft]=useState(null),[error,setError]=useState(''),[saved,setSaved]=useState(false),[busy,setBusy]=useState(false),[invitation,setInvitation]=useState(null),[emailConfigured,setEmailConfigured]=useState(null),[notice,setNotice]=useState(null),[fieldErrors,setFieldErrors]=useState({});
 const paged=section==='contacts';
 // Custom roles a member can be given; only owners and admins can read them.
 const [customRoles,setCustomRoles]=useState([]);
 useEffect(()=>{if(section==='agents'&&recordId&&recordId!=='create')nativeRequest(`/api/management/projects/${projectId}/roles`).then(r=>setCustomRoles(r.data.custom)).catch(()=>setCustomRoles([]));},[section,recordId,projectId]);
 const [listQuery,setListQuery]=useState({search:'',page:1,sort:section==='contacts'?'last_seen_at':'title',direction:section==='contacts'?'desc':'asc'}),[pagination,setPagination]=useState(null);
 const requestId=useRef(0),savedContact=useRef(null);
 const listPath=path+(paged?'?'+new URLSearchParams(listQuery):'');
 const load=useCallback(async()=>{const id=++requestId.current;const response=await nativeRequest(listPath);if(id!==requestId.current)return;setItems(response.data||response);setPagination(response.pagination||null);if(section==='agents')setEmailConfigured(response.emailConfigured);},[listPath,section]);
 useEffect(()=>{let active=true;setItems(null);setError('');const timer=setTimeout(()=>load().catch(e=>{if(active)setError(e.message)}),paged&&listQuery.search?200:0);return()=>{active=false;clearTimeout(timer);requestId.current++};},[load]);
 useEffect(()=>{
  let active=true;savedContact.current=null;setDraft(null);setInvitation(null);setNotice(null);setError('');setSaved(false);setFieldErrors({});
  if(recordId==='create'){
   const query=new URLSearchParams(routeLocation.searchStr);
   setDraft(section==='agents'?{role:'operator',is_notified_on_unassigned_activity:true}:section==='plugins'?{name:query.get('name')||'',url:query.get('url')||''}:{});
  }else if(recordId){
   (section==='agents'?nativeRequest(path).then(r=>{const row=r.data.find(item=>item.id===recordId);return {data:row&&{...row,role:row.access_role||row.role}};}):nativeRequest(`${path}/${recordId}`))
    .then(r=>{if(!r.data)throw new Error('Record not found');if(active){const value=section==='contacts'?parseContact(r.data):r.data;savedContact.current=value;setDraft(value);}})
    .catch(e=>setError(e.message));
  }
  return()=>{active=false};
 },[path,recordId,routeLocation.searchStr]);
 const change=(key,value)=>{markDirty();setSaved(false);setDraft(d=>({...d,[key]:value}));setFieldErrors(({[key]:_,...rest})=>rest);};
 const save=async e=>{
  e.preventDefault();setError('');
  const problems=validateManagementDraft(section,draft);
  if(problems){setFieldErrors(problems);setSaved(false);return;}
  setBusy(true);
  try{
   const changes=section==='contacts'&&draft.id?Object.fromEntries(Object.entries(draft).filter(([key,value])=>!Object.is(value,savedContact.current?.[key]))):draft;
   const response=await nativeRequest(path+(draft.id?`/${draft.id}`:''),{method:draft.id?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(changes)});
   markSaved();setSaved(true);
   if(section==='agents'&&!draft.id){setInvitation(response.data);await load();}
   else if(response.data?.id){const value=section==='contacts'?parseContact(response.data):{...draft,...response.data};savedContact.current=value;setDraft(value);if(recordId==='create')await navigate({to:`${base}/${response.data.id}`,replace:true});}
   await load();
  }catch(e){setError(e.message)}finally{setBusy(false)}
 };
 const erased=async()=>{markSaved();const r=await nativeRequest(`${path}/${draft.id}`);const value=parseContact(r.data);savedContact.current=value;setDraft(value);await load();};
 const move=async(id,direction)=>{try{await nativeRequest(`${path}/${id}/${direction}`,{method:'POST'});await load()}catch(e){setError(e.message)}};
 // Deleting always goes through the shared confirmation. The last owner cannot be removed; removing yourself is called out.
 const owners=(items||[]).filter(row=>row.role==='owner'&&!row.pending).length;
 const lastOwner=section==='agents'&&draft?.role==='owner'&&owners<=1;
 const removeSelf=section==='agents'&&Boolean(draft?.id)&&draft.id===currentAgent?.id;
 const requestRemoval=()=>{
  setError('');
  if(lastOwner){ask({title:'The last owner cannot be removed',confirmLabel:null,body:<p>This project needs at least one owner. Make another member an owner first, then remove this one.</p>});return;}
  const copy=deleteCopy[section];
  ask({
   title:removeSelf?'Remove yourself from this project?':copy.title(draft),
   body:<><p>{copy.effect}</p>{removeSelf&&<p><strong>You are removing yourself.</strong> You will lose access to this project immediately and be signed out.</p>}</>,
   run:async()=>{
    await nativeRequest(`${path}/${draft.id}`,{method:'DELETE'});markSaved();
    if(removeSelf){window.location.assign('/login');return;}
    await navigate({to:base});
   },
  });
 };
 return <><Feedback {...{error,saved}}/>{invitation&&<InvitationCreated invitation={invitation}/>}<InvitationNotice notice={notice}/>
  {!recordId&&<ManagementLists {...{section,items,base,projectId,emailConfigured,pagination}} query={paged?listQuery:null} onQuery={setListQuery} onMove={move} onChanged={load} onNotice={setNotice} onError={setError}/>} {recordId&&!draft&&!error&&<p>Loading…</p>}
  {draft&&section==='contacts'&&draft.is_erased&&<div className="workspace-settings"><ContactErased projectId={projectId} contact={draft}/></div>}
  {draft&&!(section==='contacts'&&draft.is_erased)&&<div className="workspace-settings">{section==='contacts'&&draft.id&&<ContactDetails projectId={projectId} contact={draft}/>}
   <form onSubmit={save} noValidate={section==='contacts'||section==='plugins'}><ManagementEditor {...{section,draft,change,emailConfigured,fieldErrors,customRoles}}/>
    <div className="settings-actions"><button className="btn btn-primary" disabled={busy||Boolean(invitation)}>{busy?'Saving…':draft.id?'Save':section==='agents'?'Invite':section==='plugins'?'Add':'Create'}</button>{draft.id&&<button type="button" className="btn btn-outline-danger ms-2" disabled={busy} onClick={requestRemoval}>Delete</button>}</div>
    {lastOwner&&<p className="settings-note mt-3">This is the project’s last owner, so it cannot be removed. Make another member an owner first.</p>}
   </form>
   {section==='contacts'&&draft.id&&<ContactErasure projectId={projectId} contact={draft} onErased={erased}/>}</div>}
  {dialog}</>;
}
